import { DynamoDB } from 'aws-sdk';
import { BetterDDB } from '../betterddb';

export class GetBuilder<T> {
  private projectionExpression?: string;
  private expressionAttributeNames: Record<string, string> = {};

  constructor(private parent: BetterDDB<T>, private key: Partial<T>) {}

  /**
   * Specify a projection by providing an array of attribute names.
   */
  public withProjection(attributes: (keyof T)[]): this {
    this.projectionExpression = attributes.map(attr => `#${String(attr)}`).join(', ');
    for (const attr of attributes) {
      this.expressionAttributeNames[`#${String(attr)}`] = String(attr);
    }
    return this;
  }

  public async execute(): Promise<T | null> {
    const params: DynamoDB.DocumentClient.GetItemInput = {
      TableName: this.parent.getTableName(),
      Key: this.parent.buildKey(this.key)
    };
    if (this.projectionExpression) {
      params.ProjectionExpression = this.projectionExpression;
      params.ExpressionAttributeNames = this.expressionAttributeNames;
    }
    const result = await this.parent.getClient().get(params).promise();
    if (!result.Item) return null;
    return this.parent.getSchema().parse(result.Item);
  }

  public then<TResult1 = T | null, TResult2 = never>(
    onfulfilled?: ((value: T | null) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }
  public catch<TResult = never>(
    onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null
  ): Promise<T | null | TResult> {
    return this.execute().catch(onrejected);
  }
  public finally(onfinally?: (() => void) | null): Promise<T | null> {
    return this.execute().finally(onfinally);
  }
}
