#!/usr/bin/env npx tsx
import { App } from "aws-cdk-lib";
import { SecretsStack } from "../lib/secrets-stack.js";
import { MessagingStack } from "../lib/messaging-stack.js";

const ACCOUNT_NO = '735029168602'
const AWS_REGION = 'us-east-2'

const app = new App();

new SecretsStack(app, "FranklinSecrets", {
  env: {
    account: ACCOUNT_NO,
    region: AWS_REGION,
  },
  description: "Franklin — secrets and API keys",
});

new MessagingStack(app, "FranklinMessaging", {
  env: {
    account: ACCOUNT_NO,
    region: AWS_REGION,
  },
  description: "Franklin — SQS inbox and SNS outbox",
});
