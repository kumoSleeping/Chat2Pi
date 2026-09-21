export declare const homeDirectory: (override?: string) => string;
export declare function serverTag(url: string): string;
export declare function loginPath(home: string, url: string, account: string): string;
export declare function bindingPath(home: string, url: string, account: string, device: string): string;
export declare function filesIn(home: string, folder: string, suffix: string): string[];
export declare const bindingFiles: (home: string) => string[];
export declare function selectLogin(home: string, account?: string, url?: string): string;
