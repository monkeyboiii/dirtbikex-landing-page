// AWS SNS sender — `Publish` to a phone number, marked Transactional.
//
// Docs: https://docs.aws.amazon.com/sns/latest/api/API_Publish.html
//       https://docs.aws.amazon.com/sns/latest/dg/sms_publish-to-phone.html
//
// SigV4 is delegated to `aws4fetch` (~5 KB, Web-Crypto only, no Node deps).
// Hand-rolling SigV4 for one endpoint isn't worth the maintenance.
//
// Default-message-type=Transactional matters: Promotional throttles harder and
// is filtered by some carriers. OTP must be Transactional, and it costs the
// same on the SNS price sheet.

import { AwsClient } from 'aws4fetch';
import type { PagesEnv } from '../types';
import type { SendResult } from './aliyun';

function buildMessage(code: string): string {
  return `Your DirtBikeX verification code is ${code}. Valid for 5 minutes.`;
}

export async function sendAwsSms(
  env: PagesEnv,
  args: { to: string; code: string },
): Promise<SendResult> {
  const ak = env.AWS_ACCESS_KEY_ID;
  const sk = env.AWS_SECRET_ACCESS_KEY;
  const region = env.AWS_SNS_REGION;
  if (!ak || !sk || !region) {
    return { ok: false, code: 'ConfigMissing', message: 'aws env not configured' };
  }

  const aws = new AwsClient({
    accessKeyId: ak,
    secretAccessKey: sk,
    region,
    service: 'sns',
  });

  const body = new URLSearchParams({
    Action: 'Publish',
    Version: '2010-03-31',
    PhoneNumber: args.to,
    Message: buildMessage(args.code),
    'MessageAttributes.entry.1.Name': 'AWS.SNS.SMS.SMSType',
    'MessageAttributes.entry.1.Value.DataType': 'String',
    'MessageAttributes.entry.1.Value.StringValue': 'Transactional',
  });
  if (env.AWS_SNS_SENDER_ID) {
    body.append('MessageAttributes.entry.2.Name', 'AWS.SNS.SMS.SenderID');
    body.append('MessageAttributes.entry.2.Value.DataType', 'String');
    body.append('MessageAttributes.entry.2.Value.StringValue', env.AWS_SNS_SENDER_ID);
  }

  let resp: Response;
  try {
    resp = await aws.fetch(`https://sns.${region}.amazonaws.com/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  } catch (err) {
    return { ok: false, code: 'NetworkError', message: String(err) };
  }

  const text = await resp.text();
  // SNS responds with XML for both success and error. We parse just enough
  // for log correlation — full XML parsing isn't worth the dep.
  const reqIdMatch = text.match(/<RequestId>([^<]+)<\/RequestId>/);
  const codeMatch = text.match(/<Code>([^<]+)<\/Code>/);
  const msgMatch = text.match(/<Message>([^<]+)<\/Message>/);

  if (!resp.ok) {
    return {
      ok: false,
      requestId: reqIdMatch?.[1],
      code: codeMatch?.[1] ?? `Http${resp.status}`,
      message: msgMatch?.[1],
      status: resp.status,
    };
  }
  return { ok: true, requestId: reqIdMatch?.[1], code: 'OK', status: resp.status };
}

// Re-export for symmetry with aliyun.ts callers.
export type { SendResult };
