export interface SchemaProperty {
  type: string | string[];
  description?: string;
  pattern?: string;
  minLength?: number;
  minimum?: number;
  default?: any;
  enum?: string[];
  items?: any;
  $ref?: string;
}

export interface GenerateConfig {
  list?: boolean;
  view?: boolean;
  new?: boolean;
  edit?: boolean;
  delete?: boolean;
  invalidate?: boolean;
}

export interface SchemaDefinition {
  type?: string;
  title?: string;
  description?: string;
  required?: string[];
  properties?: Record<string, SchemaProperty>;
  allOf?: Array<{
    $ref?: string;
    type?: string;
    required?: string[];
    properties?: Record<string, SchemaProperty>;
  }>;
  'x-generate'?: GenerateConfig;
}

export interface Schema {
  $schema: string;
  title: string;
  description: string;
  definitions: Record<string, SchemaDefinition>;
}
