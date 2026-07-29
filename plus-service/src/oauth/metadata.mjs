import { issuerUrl, mcpResourceUrl, SCOPE_DEFAULT } from "./constants.mjs";

/**
 * @param {string} publicBaseUrl
 */
export function protectedResourceMetadata(publicBaseUrl) {
  const resource = mcpResourceUrl(publicBaseUrl);
  const issuer = issuerUrl(publicBaseUrl);
  return {
    resource,
    authorization_servers: [issuer],
    scopes_supported: [SCOPE_DEFAULT, "offline_access"],
    bearer_methods_supported: ["header"],
  };
}

/**
 * @param {string} publicBaseUrl
 */
export function authorizationServerMetadata(publicBaseUrl) {
  const issuer = issuerUrl(publicBaseUrl);
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
    scopes_supported: [SCOPE_DEFAULT, "offline_access"],
  };
}
