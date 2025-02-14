import { DynamoDB } from 'aws-sdk';

export const createTestTable = async (tableName: string, keySchema: DynamoDB.CreateTableInput['KeySchema'], attributeDefinitions: DynamoDB.CreateTableInput['AttributeDefinitions']) => {
  const dynamoDB = new DynamoDB({
    region: 'us-east-1',
    endpoint: 'http://localhost:4566',
  });

  console.log('Creating DynamoDB table in LocalStack...');

  try {
    await dynamoDB.createTable({
      TableName: tableName,
      KeySchema: keySchema,
      AttributeDefinitions: attributeDefinitions,
      BillingMode: 'PAY_PER_REQUEST',
    }).promise();
  } catch (error: any) {
    if (error.code === 'ResourceInUseException') {
      console.log('Table already exists, skipping creation.');
    } else {
      throw error;
    }
  }

  // Wait for the table to become active.
  let attempts = 0;
  while (attempts < 60) { // wait up to 60 seconds
    const { Table } = await dynamoDB.describeTable({ TableName: tableName }).promise();
    if (Table?.TableStatus === 'ACTIVE') {
      console.log('DynamoDB table is ready.');
      return;
    }
    console.log('Waiting for table to become ACTIVE...');
    await new Promise((res) => setTimeout(res, 1000));
    attempts++;
  }
  throw new Error('Table did not become active in time.');
};

export const deleteTestTable = async (tableName: string) => {
  const dynamoDB = new DynamoDB({
    region: 'us-east-1',
    endpoint: 'http://localhost:4566',
  });
  try {
    await dynamoDB.deleteTable({ TableName: tableName }).promise();
  } catch (error: any) {
    if (error.code === 'ResourceNotFoundException') {
      console.log('Table not found during deletion.');
    } else {
      throw error;
    }
  }
};
