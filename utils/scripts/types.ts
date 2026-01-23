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

export interface SchemaDefinition {
  type: string;
  title: string;
  description: string;
  required: string[];
  properties: Record<string, SchemaProperty>;
}

export interface Schema {
  $schema: string;
  title: string;
  description: string;
  definitions: Record<string, SchemaDefinition>;
}
