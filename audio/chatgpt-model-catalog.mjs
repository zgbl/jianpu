// The OAuth catalog omitted this model on 2026-10-04, but a direct Responses
// request using the same project credentials succeeded. Upstream still decides
// account eligibility when a recognition request is sent.
export function withVerifiedChatGPTModels(models) {
 const verified={slug:'gpt-6.1-sol',displayName:'GPT-6.1 Sol（已验证可调用）'};
 return models.some(model=>model.slug===verified.slug)?models:[verified,...models];
}
