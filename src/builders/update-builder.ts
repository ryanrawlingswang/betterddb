
import { DynamoDB } from 'aws-sdk';
import { BetterDDB } from '../betterddb';
import { z } from 'zod';

interface UpdateActions<S extends z.ZodType<any>> {
  set?: Partial<S>;
  remove?: (keyof S)[];
  add?: Partial<Record<keyof S, number | Set<any>>>;
  delete?: Partial<Record<keyof S, Set<any>>>;
}

export class UpdateBuilder<S extends z.ZodType<any>> {
  private actions: UpdateActions<S> = {};
  private condition?: { expression: string; attributeValues: Record<string, any> };
  private expectedVersion?: number;
  // When using transaction mode, we store extra transaction items.
  private extraTransactItems: DynamoDB.DocumentClient.TransactWriteItemList = [];

  // Reference to the parent BetterDDB instance and key.
  constructor(private parent: BetterDDB<S>, private key: Partial<S>, expectedVersion?: number) {
    this.expectedVersion = expectedVersion;
  }

  // Chainable methods:
  public set(attrs: Partial<S>): this {
    this.actions.set = { ...this.actions.set, ...attrs };
    return this;
  }

  public remove(attrs: (keyof S)[]): this {
    this.actions.remove = [...(this.actions.remove || []), ...attrs];
    return this;
  }

  public add(attrs: Partial<Record<keyof S, number | Set<any>>>): this {
    this.actions.add = { ...this.actions.add, ...attrs };
    return this;
  }

  public delete(attrs: Partial<Record<keyof S, Set<any>>>): this {
    this.actions.delete = { ...this.actions.delete, ...attrs };
    return this;
  }

  /**
   * Adds a condition expression to the update.
   */
  public setCondition(expression: string, attributeValues: Record<string, any>): this {
    if (this.condition) {
      // Merge conditions with AND.
      this.condition.expression += ` AND ${expression}`;
      Object.assign(this.condition.attributeValues, attributeValues);
    } else {
      this.condition = { expression, attributeValues };
    }
    return this;
  }

  /**
   * Specifies additional transaction items to include when executing this update as a transaction.
   */
  public transactWrite(ops: DynamoDB.DocumentClient.TransactWriteItemList | DynamoDB.DocumentClient.TransactWriteItem): this {
    if (Array.isArray(ops)) {
      this.extraTransactItems.push(...ops);
    } else {
      this.extraTransactItems.push(ops);
    }
    return this;
  }

  /**
   * Builds the update expression and associated maps.
   */
  private buildExpression(): {
    updateExpression: string;
    attributeNames: Record<string, string>;
    attributeValues: Record<string, any>;
  } {
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

      // Ensure condition expression includes version check.
      if (this.condition && this.condition.expression) {
        this.condition.expression += ` AND #version = :expectedVersion`;
      } else {
        this.condition = { expression: '#version = :expectedVersion', attributeValues: {} };
      }
    }

    // Merge any provided condition attribute values.
    if (this.condition) {
      Object.assign(ExpressionAttributeValues, this.condition.attributeValues);
    }

    return {
      updateExpression: clauses.join(' '),
      attributeNames: ExpressionAttributeNames,
      attributeValues: ExpressionAttributeValues
    };
  }

  /**
   * Returns a transaction update item that can be included in a transactWrite call.
   */
  public toTransactUpdate(): DynamoDB.DocumentClient.TransactWriteItem {
    const { updateExpression, attributeNames, attributeValues } = this.buildExpression();
    const updateItem: DynamoDB.DocumentClient.Update = {
      TableName: this.parent.getTableName(),
      Key: this.parent.buildKey(this.key),
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: attributeNames,
      ExpressionAttributeValues: attributeValues
    };
    if (this.condition && this.condition.expression) {
      updateItem.ConditionExpression = this.condition.expression;
    }
    return { Update: updateItem };
  }

  /**
   * Commits the update immediately by calling the parent's update method.
   */
  public async execute(): Promise<S> {
    if (this.extraTransactItems.length > 0) {
      // Build our update transaction item.
      const myTransactItem = this.toTransactUpdate();
      // Combine with extra transaction items.
      const allItems = [...this.extraTransactItems, myTransactItem];
      await this.parent.getClient().transactWrite({
        TransactItems: allItems
      }).promise();
      // After transaction, retrieve the updated item.
      const result = await this.parent.get(this.key).execute();
      if (result === null) {
        throw new Error('Item not found after transaction update');
      }
      return result;
    } else {
      // Normal update flow.
      const { updateExpression, attributeNames, attributeValues } = this.buildExpression();
      const params: DynamoDB.DocumentClient.UpdateItemInput = {
        TableName: this.parent.getTableName(),
        Key: this.parent.buildKey(this.key),
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: attributeNames,
        ExpressionAttributeValues: attributeValues,
        ReturnValues: 'ALL_NEW'
      };
      if (this.condition && this.condition.expression) {
        params.ConditionExpression = this.condition.expression;
      }
      const result = await this.parent.getClient().update(params).promise();
      if (!result.Attributes) {
        throw new Error('No attributes returned after update');
      }
      return this.parent.getSchema().parse(result.Attributes);
    }
  }
}
