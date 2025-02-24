import { type BetterDDB } from "../betterddb";
import {  TransactGetCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { type GetItemInput, type TransactGetItem } from "@aws-sdk/client-dynamodb";
export class GetBuilder<T> {
  private projectionExpression?: string;
  private expressionAttributeNames: Record<string, string> = {};
  private extraTransactItems: TransactGetItem[] = [];
  constructor(
    private parent: BetterDDB<T>,
    private key: Partial<T>,
  ) {}

  /**
   * Specify a projection by providing an array of attribute names.
   */
  public withProjection(attributes: (keyof T)[]): this {
    this.projectionExpression = attributes
      .map((attr) => `#${String(attr)}`)
      .join(", ");
    for (const attr of attributes) {
      this.expressionAttributeNames[`#${String(attr)}`] = String(attr);
    }
    return this;
  }

  public async execute(): Promise<T | null> {
    if (this.extraTransactItems.length > 0) {
      // Build our update transaction item.
      const myTransactItem = this.toTransactGet();
      // Combine with extra transaction items.
      const allItems = [...this.extraTransactItems, myTransactItem];
      await this.parent.getClient().send(
        new TransactGetCommand({
          TransactItems: allItems,
        }),
      );
      // After transaction, retrieve the updated item.
      const result = await this.parent.get(this.key).execute();
      return result;
    } else {
      const params: GetItemInput = {
        TableName: this.parent.getTableName(),
        Key: this.parent.buildKey(this.key),
      };
      if (this.projectionExpression) {
        params.ProjectionExpression = this.projectionExpression;
        params.ExpressionAttributeNames = this.expressionAttributeNames;
      }
      const result = await this.parent.getClient().send(new GetCommand(params));
      if (!result.Item) return null;
      return this.parent.getSchema().parse(result.Item) as T;
    }
  }

  public transactGet(ops: TransactGetItem[] | TransactGetItem): this {
    if (Array.isArray(ops)) {
      this.extraTransactItems.push(...ops);
    } else {
      this.extraTransactItems.push(ops);
    }
    return this;
  }

  public toTransactGet(): TransactGetItem {
    const getItem: GetItemInput = {
      TableName: this.parent.getTableName(),
      Key: this.parent.buildKey(this.key),
    };
    if (this.projectionExpression) {
      getItem.ProjectionExpression = this.projectionExpression;
      getItem.ExpressionAttributeNames = this.expressionAttributeNames;
    }
    return { Get: getItem };
  }
}
