const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

export const pageHeaders = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy":
    "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; style-src 'unsafe-inline'",
};

const style = `
:root{color-scheme:light;--paper:#f9f8f5;--ink:#292924;--muted:#75746d;--line:#deddd6;--accent:#52644c}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:14px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;-webkit-font-smoothing:antialiased}
main{width:calc(100% - 48px);max-width:360px;margin:clamp(64px,16vh,160px) auto 48px}.masthead{font-size:13px;font-weight:500;color:var(--muted);margin-bottom:32px}h1{font-size:27px;line-height:1.4;letter-spacing:-.7px;font-weight:550;margin:0 0 32px}.intro{color:var(--muted);margin:0 0 24px}
.field{display:block;margin-bottom:20px}.field-label{display:block;font-size:13px;margin-bottom:8px}input:not([type=hidden]){display:block;width:100%;height:46px;border:1px solid var(--line);border-radius:4px;background:rgba(255,255,255,.4);color:var(--ink);padding:0 12px;font:inherit}input:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
button{width:100%;min-height:46px;border:0;border-radius:4px;background:var(--ink);color:var(--paper);font:inherit;padding:12px;cursor:pointer}button:hover{background:#41413a}button:disabled{opacity:.6;cursor:default}button:focus-visible,a:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:4px}a{color:var(--accent);text-underline-offset:4px}.permission{font-size:12px;color:var(--muted);line-height:1.8;margin:16px 0 24px}
details{font-size:12px;color:var(--muted)}summary{cursor:pointer;list-style:none;width:fit-content}summary::-webkit-details-marker{display:none}summary:hover{text-decoration:underline;text-underline-offset:4px}dl{margin:14px 0 0}dt{margin-top:10px}dd{margin:3px 0 0;color:var(--ink);overflow-wrap:anywhere}
.result{margin-top:16px;font-size:13px;overflow-wrap:anywhere}.result:empty{display:none}.result[data-error=true]{color:#995443}.result a{display:inline-block;margin-top:8px}
@media(max-width:520px){main{margin-top:64px}h1{font-size:26px}}
`;

function page(
  body: string,
  title: string,
  extra: Record<string, string> = {},
  status = 200,
) {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escape(title)} · Chat2Pi</title><style>${style}</style></head><body><main><header class="masthead">Chat2Pi</header>${body}</main></body></html>`,
    {
      status,
      headers: {
        ...pageHeaders,
        "Content-Type": "text/html; charset=utf-8",
        ...extra,
      },
    },
  );
}

export function authorizationPage(input: {
  id: string;
  csrf: string;
  clientName: string;
  redirectUri: string;
}) {
  return page(
    `<h1>Connect your computers</h1><p class="intro">Use the connection key from your account file when adding Chat2Pi to ChatGPT.</p><form method="post" action="/approve"><input type="hidden" name="request" value="${escape(input.id)}"><label class="field"><span class="field-label">Connection key</span><input name="owner_key" type="password" required autocomplete="off"></label><button type="submit">Authorize connection</button></form><p class="permission">Allow enabled tools to read and write files and run commands.</p><details><summary>Connection details</summary><dl><dt>Application</dt><dd>${escape(input.clientName)}</dd><dt>Return address</dt><dd>${escape(input.redirectUri)}</dd></dl></details>`,
    "Authorize connection",
    {
      "Set-Cookie": `pi_consent=${input.csrf}; HttpOnly; Secure; SameSite=Lax; Path=/approve; Max-Age=300`,
    },
  );
}

export function claimPage() {
  const nonce = crypto.randomUUID();
  return page(
    `<h1>Download credentials</h1><button id="claim" type="button">Download</button><div id="result" class="result" role="status" aria-live="polite"></div><script nonce="${nonce}">
const token=location.hash.slice(1);history.replaceState(null,'',location.pathname);
const button=document.getElementById('claim'),result=document.getElementById('result');
if(!token){button.disabled=true;result.dataset.error='true';result.textContent='Incomplete link. Open the original claim link.';}
button.onclick=async()=>{
  button.disabled=true;button.textContent='Preparing…';result.textContent='';delete result.dataset.error;
  try{
    const response=await fetch('/claim',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:token})});
    if(!response.ok)throw Error('This link is no longer valid. Request new credentials.');
    const value=await response.json(),blob=new Blob([JSON.stringify(value,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');
    const device=!!value.binding;
    link.href=url;link.download=device?value.binding.device_id+'.json':'link_chatgpt_plugin_oauth_'+value.account_id+'.json';link.textContent='Download again';
    document.querySelector('h1').textContent=device?'Device configuration':'Connection account';
    const help=document.createElement('p');help.className='intro';help.textContent=device?'On the target computer, run chat2pi folder, drop this file into the opened folder, then run chat2pi start.':'Keep this account file for ChatGPT setup. Enter its login_key in the Connection key field when authorizing the plugin. It contains no device credentials.';result.append(help);
    result.append(document.createTextNode(link.download),document.createElement('br'),link);link.click();
    button.textContent='Claimed';
  }catch(error){result.dataset.error='true';result.textContent=error instanceof TypeError?'Connection lost. Try again, or request new credentials if already claimed.':error.message;button.disabled=false;button.textContent='Try again';}
};</script>`,
    "Download credentials",
    {
      "Content-Security-Policy": `${pageHeaders["Content-Security-Policy"]}; script-src 'nonce-${nonce}'; connect-src 'self'`,
    },
  );
}

export function authorizationErrorPage() {
  const nonce = crypto.randomUUID();
  return page(
    `<h1>Unable to connect</h1><p class="intro">Check your connection key. If authorization has expired, start again.</p><button id="back" type="button">Go back</button><script nonce="${nonce}">document.getElementById('back').onclick=()=>history.back();</script>`,
    "Unable to connect",
    {
      "Content-Security-Policy": `${pageHeaders["Content-Security-Policy"]}; script-src 'nonce-${nonce}'`,
    },
    403,
  );
}
