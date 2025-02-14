// src/update-builder.ts
import { DynamoDB } from 'aws-sdk';
import { BetterDDB } from './betterddb';

interface UpdateActions<T> {
  set?: Partial<T>;
  remove?: (keyof T)[];
  add?: Partial<Record<keyof T, number | Set<any>>>;
  delete?: Partial<Record<keyof T, Set<any>>>;
}

export class UpdateBuilder<T> {
  private actions: UpdateActions<T> = {};
  private condition?: { expression: string; attributeValues: Record<string, any> };
  private expectedVersion?: number;
  
  // Reference to the parent BetterDDB instance and key.
  constructor(private parent: BetterDDB<T>, private key: Partial<T>, expectedVersion?: number) {
    this.expectedVersion = expectedVersion;
  }

  // Chainable methods:
  public set(attrs: Partial<T>): this {
    this.actions.set = { ...this.actions.set, ...attrs };
    return this;
  }

  public remove(attrs: (keyof T)[]): this {
    this.actions.remove = [...(this.actions.remove || []), ...attrs];
    return this;
  }

  public add(attrs: Partial<Record<keyof T, number | Set<any>>>): this {
    this.actions.add = { ...this.actions.add, ...attrs };
    return this;
  }

  public delete(attrs: Partial<Record<keyof T, Set<any>>>): this {
    this.actions.delete = { ...this.actions.delete, ...attrs };
    return this;
  }

  public setCondition(expression: string, attributeValues: Record<string, any>): this {
    this.condition = { expression, attributeValues };
    return this;
  }

  /**
   * Commits the update. This method builds the full update expression,
   * calls the parent's update method, and returns a Promise.
   */
  private async commit(): Promise<T> {
    const ExpressionAttributeNames: Record<string, string> = {};
    const ExpressionAttributeValues: Record<string, any> = {};
    const clauses: string[] = [];

    // Build SET clause.
    if (this.actions.set) {
      const setParts: string[] = [];
      for (const [attr, value] of Object.entries(this.actions.set)) {
        const nameKey = `#set_${attr}`;
        const valueKey = `:set_${attr}`;
        ExpressionAttributeNames[nameKey] = attr;
        ExpressionAttributeValues[valueKey] = value;
        setParts.push(`${nameKey} = ${valueKey}`);
      }
      if (setParts.length > 0) {
        clauses.push(`SET ${setParts.join(', ')}`);
      }
    }

    // Build REMOVE clause.
    if (this.actions.remove && this.actions.remove.length > 0) {
      const removeParts = this.actions.remove.map(attr => {
        const nameKey = `#remove_${String(attr)}`;
        ExpressionAttributeNames[nameKey] = String(attr);
        return nameKey;
      });
      clauses.push(`REMOVE ${removeParts.join(', ')}`);
    }

    // Build ADD clause.
    if (this.actions.add) {
      const addParts: string[] = [];
      for (const [attr, value] of Object.entries(this.actions.add)) {
        const nameKey = `#add_${attr}`;
        const valueKey = `:add_${attr}`;
        ExpressionAttributeNames[nameKey] = attr;
        ExpressionAttributeValues[valueKey] = value;
        addParts.push(`${nameKey} ${valueKey}`);
      }
      if (addParts.length > 0) {
        clauses.push(`ADD ${addParts.join(', ')}`);
      }
    }

    // Build DELETE clause.
    if (this.actions.delete) {
      const deleteParts: string[] = [];
      for (const [attr, value] of Object.entries(this.actions.delete)) {
        const nameKey = `#delete_${attr}`;
        const valueKey = `:delete_${attr}`;
        ExpressionAttributeNames[nameKey] = attr;
        ExpressionAttributeValues[valueKey] = value;
        deleteParts.push(`${nameKey} ${valueKey}`);
      }
      if (deleteParts.length > 0) {
        clauses.push(`DELETE ${deleteParts.join(', ')}`);
      }
    }

    // Incorporate expectedVersion if provided.
    if (this.expectedVersion !== undefined) {
      ExpressionAttributeNames['#version'] = 'version';
      ExpressionAttributeValues[':expectedVersion'] = this.expectedVersion;
      ExpressionAttributeValues[':newVersion'] = this.expectedVersion + 1;
      // Append version update in SET clause.
      const versionClause = '#version = :newVersion';
      const setIndex = clauses.findIndex(clause => clause.startsWith('SET '));
      if (setIndex >= 0) {
        clauses[setIndex] += `, ${versionClause}`;
      } else {
        clauses.push(`SET ${versionClause}`);
      }
      // Append condition expression.
      if (this.condition) {
        this.condition.expression += ` AND #version = :expectedVersion`;
      } else {
        this.condition = { expression: '#version = :expectedVersion', attributeValues: {} };
      }
    }

    // Combine clauses into a final update expression.
    const UpdateExpression = clauses.join(' ');

    // Merge any provided condition attribute values.
    if (this.condition) {
      Object.assign(ExpressionAttributeValues, this.condition.attributeValues);
    }

    const params: DynamoDB.DocumentClient.UpdateItemInput = {
      TableName: this.parent.getTableName(),
      Key: this.parent.buildKeyPublic(this.key),
      UpdateExpression,
      ExpressionAttributeNames,
      ExpressionAttributeValues,
      ReturnValues: 'ALL_NEW'
    };

    if (this.condition && this.condition.expression) {
      params.ConditionExpression = this.condition.expression;
    }

    return this.parent.getClient().update(params).promise().then(result => {
      if (!result.Attributes) {
        throw new Error('No attributes returned after update');
      }
      return this.parent.getSchema().parse(result.Attributes);
    });
  }

  // Make the builder thenable so that it can be awaited directly.
  public then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.commit().then(onfulfilled, onrejected);
  }
  public catch<TResult = never>(
    onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null
  ): Promise<T | TResult> {
    return this.commit().catch(onrejected);
  }
  public finally(onfinally?: (() => void) | null): Promise<T> {
    return this.commit().finally(onfinally);
  }
}
