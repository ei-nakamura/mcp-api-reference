export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

export interface ParameterInfo {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

export interface FieldInfo {
  name: string;
  type: string;
  description: string;
}

export interface ExampleInfo {
  type: "request" | "response";
  format: "json" | "curl" | "url";
  content: string;
}

export interface EndpointDocument {
  id: string;            // "{apiId}:{method}:{path}"
  apiId: string;
  category: string;
  method: HttpMethod;
  path: string;
  title: string;
  description: string;
  parameters: ParameterInfo[];
  responseFields: FieldInfo[];
  examples: ExampleInfo[];
  authentication: string[];
  permissions: string[];
  notes: string[];
  sourceUrl: string;
}
