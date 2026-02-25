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
  'x-relationship'?: {
    type: 'many-to-one';
    target: string;
    labelField?: string;
    scope?: string;
  };
}

export interface GenerateConfig {
  list?: boolean;
  view?: boolean;
  new?: boolean;
  edit?: boolean;
  delete?: boolean;
  invalidate?: boolean;
  test?: boolean;      // E2E test generation
  api?: boolean;       // API route generation
  fields?: string[];   // Optional whitelist of base entity fields
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
  'x-relationships'?: SchemaRelationships<any>;
}

export type SchemaRelationships<K extends keyof any> = {
  [P in K]: {
    target: string;
    type: string;
  }
}

export interface Schema {
  $schema: string;
  title: string;
  description: string;
  definitions: Record<string, SchemaDefinition>;
}
