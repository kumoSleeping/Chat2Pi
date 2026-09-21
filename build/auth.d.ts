import type { Express, Response } from "express";
import type { OAuthServerProvider, AuthorizationParams } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
export declare class PersonalAuth implements OAuthServerProvider {
    readonly origin: string;
    readonly stateFile: string;
    private state;
    private requests;
    private codes;
    private ownerKey;
    constructor(origin: string, stateFile: string, ownerKeyFile: string);
    private persist;
    readonly clientsStore: {
        getClient: (id: string) => {
            redirect_uris: string[];
            client_id: string;
            token_endpoint_auth_method?: string | undefined;
            grant_types?: string[] | undefined;
            response_types?: string[] | undefined;
            client_name?: string | undefined;
            client_uri?: string | undefined;
            logo_uri?: string | undefined;
            scope?: string | undefined;
            contacts?: string[] | undefined;
            tos_uri?: string | undefined;
            policy_uri?: string | undefined;
            jwks_uri?: string | undefined;
            jwks?: any;
            software_id?: string | undefined;
            software_version?: string | undefined;
            software_statement?: string | undefined;
            client_secret?: string | undefined;
            client_id_issued_at?: number | undefined;
            client_secret_expires_at?: number | undefined;
        } | undefined;
        registerClient: (client: Omit<OAuthClientInformationFull, "client_id" | "client_id_issued_at">) => {
            client_id: string;
            client_id_issued_at: number;
            redirect_uris: string[];
            token_endpoint_auth_method?: string | undefined;
            grant_types?: string[] | undefined;
            response_types?: string[] | undefined;
            client_name?: string | undefined;
            client_uri?: string | undefined;
            logo_uri?: string | undefined;
            scope?: string | undefined;
            contacts?: string[] | undefined;
            tos_uri?: string | undefined;
            policy_uri?: string | undefined;
            jwks_uri?: string | undefined;
            jwks?: any;
            software_id?: string | undefined;
            software_version?: string | undefined;
            software_statement?: string | undefined;
            client_secret?: string | undefined;
            client_secret_expires_at?: number | undefined;
        };
    };
    private checkResource;
    authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void>;
    mount(app: Express): void;
    private code;
    challengeForAuthorizationCode(client: OAuthClientInformationFull, code: string): Promise<string>;
    private issue;
    exchangeAuthorizationCode(client: OAuthClientInformationFull, code: string, _verifier?: string, redirectUri?: string, resource?: URL): Promise<{
        access_token: string;
        token_type: string;
        id_token?: string | undefined;
        expires_in?: number | undefined;
        scope?: string | undefined;
        refresh_token?: string | undefined;
    }>;
    exchangeRefreshToken(client: OAuthClientInformationFull, refresh: string, scopes?: string[], resource?: URL): Promise<{
        access_token: string;
        token_type: string;
        id_token?: string | undefined;
        expires_in?: number | undefined;
        scope?: string | undefined;
        refresh_token?: string | undefined;
    }>;
    verifyAccessToken(value: string): Promise<{
        token: string;
        clientId: string;
        scopes: string[];
        expiresAt: number;
        resource: URL;
    }>;
    revokeToken(client: OAuthClientInformationFull, request: {
        token: string;
    }): Promise<void>;
}
