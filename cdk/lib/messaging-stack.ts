import { CfnOutput, Duration, Stack, StackProps } from "aws-cdk-lib";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { Topic } from "aws-cdk-lib/aws-sns";
import { Construct } from "constructs";

export class MessagingStack extends Stack {
  public readonly inbox: Queue;
  public readonly outbox: Topic;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const deadLetter = new Queue(this, "InboxDLQ", {
      queueName: "franklin-inbox-dlq",
      retentionPeriod: Duration.days(14),
    });

    this.inbox = new Queue(this, "Inbox", {
      queueName: "franklin-inbox",
      visibilityTimeout: Duration.minutes(5),
      retentionPeriod: Duration.days(4),
      deadLetterQueue: {
        queue: deadLetter,
        maxReceiveCount: 3,
      },
    });

    this.outbox = new Topic(this, "Outbox", {
      topicName: "franklin-outbox",
      displayName: "Franklin Outbox",
    });
  }
}
