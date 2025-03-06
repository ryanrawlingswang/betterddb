import { type NativeAttributeValue, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { type BetterDDB } from "../betterddb";
import {
  type TransactWriteItem,
  type Update,
  type UpdateItemInput,
} from "@aws-sdk/client-dynamodb";
import { type z } from "zod";
interface UpdateActions<T> {
  set?: Partial<T>;
  remove?: (keyof T)[];
  add?: Partial<Record<keyof T, number | Set<NativeAttributeValue>>>;
  delete?: Partial<Record<keyof T, Set<NativeAttributeValue>>>;
}

export class UpdateBuilder<T> {
  private actions: UpdateActions<T> = {};
  private condition?: {
    expression: string;
    attributeValues: Record<string, NativeAttributeValue>;
    attributeNames: Record<string, string>;
  };
  // When using transaction mode, we store extra transaction items.
  private extraTransactItems: TransactWriteItem[] = [];

  // Reference to the parent BetterDDB instance and key.
  constructor(
    private parent: BetterDDB<T>,
    private key: Partial<T>,
  ) {}

  // Chainable methods:
  public set(attrs: Partial<T>): this {
    const partialSchema = this.parent.getSchema().partial();
    const validated = partialSchema.parse(attrs);
    this.actions.set = { ...this.actions.set, ...validated };
    return this;
  }

  public remove(attrs: (keyof T)[]): this {
    this.actions.remove = [...(this.actions.remove ?? []), ...attrs];
    return this;
  }

  public add(attrs: Partial<Record<keyof T, number | Set<NativeAttributeValue>>>): this {
    const partialSchema = this.parent.getSchema().partial();
    const validated = partialSchema.parse(attrs);
    this.actions.add = { ...this.actions.add, ...validated };
    return this;
  }

  public delete(attrs: Partial<Record<keyof T, Set<NativeAttributeValue>>>): this {
    this.actions.delete = { ...this.actions.delete, ...attrs };
    return this;
  }

  /**
   * Adds a condition expression to the update.
   */
  public setCondition(
    expression: string,
    attributeValues: Record<string, NativeAttributeValue>,
    attributeNames: Record<string, string>
  ): this {
    if (this.condition) {
      // Merge conditions with AND.
      this.condition.expression += ` AND ${expression}`;
      Object.assign(this.condition.attributeValues, attributeValues);
      Object.assign(this.condition.attributeNames, attributeNames);
    } else {
      this.condition = { 
        expression, 
        attributeValues,
        attributeNames
      };
    }
    return this;
  }

  /**
   * Specifies additional transaction items to include when executing this update as a transaction.
   */
  public transactWrite(ops: TransactWriteItem[] | TransactWriteItem): this {
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
    attributeValues?: Record<string, NativeAttributeValue>;
  } {
    const ExpressionAttributeNames: Record<string, string> = {};
    let ExpressionAttributeValues: Record<string, NativeAttributeValue> | undefined = {};
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
        clauses.push(`SET ${setParts.join(", ")}`);
      }
    }

    // Build REMOVE clause.
    if (this.actions.remove && this.actions.remove.length > 0) {
      const removeParts = this.actions.remove.map((attr) => {
        const nameKey = `#remove_${String(attr)}`;
        ExpressionAttributeNames[nameKey] = String(attr);
        return nameKey;
      });
      clauses.push(`REMOVE ${removeParts.join(", ")}`);
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
        clauses.push(`ADD ${addParts.join(", ")}`);
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
        clauses.push(`DELETE ${deleteParts.join(", ")}`);
      }
    }

    // Merge any provided condition attribute names and values
    if (this.condition) {
      Object.assign(ExpressionAttributeNames, this.condition.attributeNames);
      Object.assign(ExpressionAttributeValues, this.condition.attributeValues);
    }

    if (Object.keys(ExpressionAttributeValues).length === 0) {
      ExpressionAttributeValues = undefined;
    }

    return {
      updateExpression: clauses.join(" "),
      attributeNames: ExpressionAttributeNames,
      attributeValues: ExpressionAttributeValues,
    };
  }

  /**
   * Returns a transaction update item that can be included in a transactWrite call.
   */
  public toTransactUpdate(): TransactWriteItem {
    const { updateExpression, attributeNames, attributeValues } =
      this.buildExpression();
    const updateItem: Update = {
      TableName: this.parent.getTableName(),
      Key: this.parent.buildKey(this.key),
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: attributeNames,
      ExpressionAttributeValues: attributeValues,
    };
    if (this.condition?.expression) {
      updateItem.ConditionExpression = this.condition.expression;
    }
    return { Update: updateItem };
  }

  /**
   * Commits the update immediately by calling the parent's update method.
   */
  public async execute(): Promise<T> {
    if (this.extraTransactItems.length > 0) {
      // Build our update transaction item.
      const myTransactItem = this.toTransactUpdate();
      // Combine with extra transaction items.
      const allItems = [...this.extraTransactItems, myTransactItem];
      await this.parent.getClient().send(
        new TransactWriteCommand({
          TransactItems: allItems,
        }),
      );
      // After transaction, retrieve the updated item.
      const result = await this.parent.get(this.key).execute();
      if (result === null) {
        throw new Error("Item not found after transaction update");
      }
      return result;
    } else {
      // Normal update flow.
      const { updateExpression, attributeNames, attributeValues } =
        this.buildExpression();
      const params: UpdateItemInput = {
        TableName: this.parent.getTableName(),
        Key: this.parent.buildKey(this.key),
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: attributeNames,
        ExpressionAttributeValues: attributeValues,
        ReturnValues: "ALL_NEW",
      };
      if (this.condition?.expression) {
        params.ConditionExpression = this.condition.expression;
      }
      const result = await this.parent
        .getClient()
        .send(new UpdateCommand(params));
      if (!result.Attributes) {
        throw new Error("No attributes returned after update");
      }
      return this.parent.getSchema().parse(result.Attributes) as T;
    }
  }
}
