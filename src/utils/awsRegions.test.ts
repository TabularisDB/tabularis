import { describe, expect, it } from "vitest";
import {
  AWS_REGION_CODES,
  regionFromDynamoDbHost,
} from "./awsRegions";

describe("awsRegions", () => {
  it("lists the commercial AWS regions from the AWS Regions docs", () => {
    expect(AWS_REGION_CODES).toContain("us-west-2");
    expect(AWS_REGION_CODES).toContain("ap-southeast-2");
    expect(AWS_REGION_CODES).toContain("eu-central-1");
    expect(AWS_REGION_CODES).toHaveLength(34);
  });

  it("parses region from a standard DynamoDB hostname", () => {
    expect(regionFromDynamoDbHost("dynamodb.us-west-2.amazonaws.com")).toBe(
      "us-west-2",
    );
    expect(
      regionFromDynamoDbHost("https://dynamodb.eu-west-1.amazonaws.com:443"),
    ).toBe("eu-west-1");
  });

  it("returns null for non-AWS hosts", () => {
    expect(regionFromDynamoDbHost("localhost")).toBeNull();
    expect(regionFromDynamoDbHost("127.0.0.1")).toBeNull();
    expect(regionFromDynamoDbHost(undefined)).toBeNull();
  });
});
