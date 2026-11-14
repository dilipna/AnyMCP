// Zod-free subset for the content script (it runs inside web pages and must stay small).
export { isParamRef, resolveText, type TextRef, type ValueRef } from "./text";
export { isCredentialQueryKey, isSensitiveField, looksSensitive, type FieldDescriptor } from "./sensitive";
