import { z } from 'zod';
import { DynamoDB } from 'aws-sdk';
import { QueryBuilder } from './builders/query-builder';
import { ScanBuilder } from './builders/scan-builder';
import { UpdateBuilder } from './builders/update-builder';
import { CreateBuilder } from './builders/create-builder';
import { GetBuilder } from './builders/get-builder';
import { DeleteBuilder } from './builders/delete-builder';

export type SchemaType<S extends z.ZodType<any>> = z.infer<S>;

export type PrimaryKeyValue = string | number;

export type KeyDefinition<S extends z.ZodType<any>> =
  | keyof SchemaType<S>
  | {
      build: (rawKey: Partial<SchemaType<S>>) => string;
    };

export interface PrimaryKeyConfig<S extends z.ZodType<any>> {
  name: string;
  definition: KeyDefinition<S>;
}

export interface SortKeyConfig<S extends z.ZodType<any>> {
  name: string;
  definition: KeyDefinition<S>;
}

export interface GSIConfig<S extends z.ZodType<any>> {
  name: string;
  primary: PrimaryKeyConfig<S>;
  sort?: SortKeyConfig<S>;
}

export interface KeysConfig<S extends z.ZodType<any>> {
  primary: PrimaryKeyConfig<S>;
  sort?: SortKeyConfig<S>;
  gsis?: {
    [gsiName: string]: GSIConfig<S>;
  };
}

export interface BetterDDBOptions<S extends z.ZodType<any>> {
  schema: S;
  tableName: string;
  entityName: string;
  keys: KeysConfig<S>;
  client: DynamoDB.DocumentClient;
  autoTimestamps?: boolean;
}

export class BetterDDB<S extends z.ZodType<any>> {
  protected schema: S;
  protected tableName: string;
  protected entityName: string;
  protected client: DynamoDB.DocumentClient;
  protected keys: KeysConfig<S>;
  protected autoTimestamps: boolean;

  constructor(options: BetterDDBOptions<S>) {
    this.schema = options.schema;
    this.tableName = options.tableName;
    this.entityName = options.entityName.toUpperCase();
    this.client = options.client;
    this.autoTimestamps = options.autoTimestamps ?? false;
    this.keys = options.keys;
  }

  public getKeys(): KeysConfig<S> {
    return this.keys;
  }

  public getTableName(): string {
    return this.tableName;
  }

  public getClient(): DynamoDB.DocumentClient {
    return this.client;
  }

  public getSchema(): S {
    return this.schema;
  }

  public getAutoTimestamps(): boolean {
    return this.autoTimestamps;
  }

  protected getKeyValue(
    def: KeyDefinition<S>,
    rawKey: Partial<SchemaType<S>>
  ): string {
    if (typeof def === 'string' || typeof def === 'number' || typeof def === 'symbol') {
      return String(rawKey[def as keyof typeof rawKey]);
    }
    return def.build(rawKey);
  }

  public buildKey(rawKey: Partial<SchemaType<S>>): Record<string, any> {
    const keyObj: Record<string, any> = {};
    const { primary, sort } = this.keys;

    keyObj[primary.name] = this.getKeyValue(primary.definition, rawKey);

    if (sort) {
      keyObj[sort.name] = this.getKeyValue(sort.definition, rawKey);
    }

    return keyObj;
  }

  public buildIndexes(rawItem: Partial<SchemaType<S>>): Record<string, any> {
    const indexAttributes: Record<string, any> = {};
    
    if (this.keys.gsis) {
      Object.entries(this.keys.gsis).forEach(([_, gsiConfig]) => {
        const { primary, sort } = gsiConfig;
        indexAttributes[primary.name] = this.getKeyValue(primary.definition, rawItem);
        
        if (sort) {
          indexAttributes[sort.name] = this.getKeyValue(sort.definition, rawItem);
        }
      });
    }
    
    return indexAttributes;
  }

  public create(item: SchemaType<S>): CreateBuilder<SchemaType<S>> {
    return new CreateBuilder<SchemaType<S>>(this, item);
  }

  public get(rawKey: Partial<SchemaType<S>>): GetBuilder<SchemaType<S>> {
    return new GetBuilder<SchemaType<S>>(this, rawKey);
  }

  public update(
    key: Partial<SchemaType<S>>,
    expectedVersion?: number
  ): UpdateBuilder<SchemaType<S>> {
    return new UpdateBuilder<SchemaType<S>>(this, key, expectedVersion);
  }

  public delete(rawKey: Partial<SchemaType<S>>): DeleteBuilder<SchemaType<S>> {
    return new DeleteBuilder<SchemaType<S>>(this, rawKey);
  }

  public query(key: Partial<SchemaType<S>>): QueryBuilder<SchemaType<S>> {
    return new QueryBuilder<SchemaType<S>>(this, key);
  }

  public scan(): ScanBuilder<SchemaType<S>> {
    return new ScanBuilder<SchemaType<S>>(this);
  }
}