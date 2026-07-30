import { z } from 'zod';
import {
  AUTHENTICITY_CLAIM,
  AUTHENTICITY_STATUS,
  COMMUNICATION_AUDIENCE,
  COMMUNICATION_CATEGORY,
  DISCOVERY_MODE,
  MAX_OPTIONS,
  MAX_PROPOSALS,
  MIN_OPTIONS,
  SNAP_DELIVERY_MODE,
} from '@pv/shared';

const isoDate = z.string().datetime({ offset: true });
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const signature = z.string().regex(/^0x[0-9a-fA-F]+$/);

const proposal = z.object({
  title: z.string().trim().min(1).max(220),
  description: z.string().trim().max(5000).default(''),
  options: z.array(z.string().trim().min(1).max(180)).min(MIN_OPTIONS).max(MAX_OPTIONS),
  recommendation: z.number().int().min(0).max(MAX_OPTIONS - 1).nullable().default(null),
});

export const eventInput = z.object({
  tokenAddress: address,
  title: z.string().trim().min(1).max(180),
  description: z.string().trim().max(8000).default(''),
  recordDateAt: isoDate,
  votingStartAt: isoDate,
  votingEndAt: isoDate,
  tokenToVoteRatio: z.coerce.number().int().positive().max(1_000_000_000),
  authenticityClaim: z.enum(Object.values(AUTHENTICITY_CLAIM)),
  discoveryMode: z.enum(Object.values(DISCOVERY_MODE)),
  snapDeliveryMode: z.enum(Object.values(SNAP_DELIVERY_MODE)),
  proposals: z.array(proposal).min(1).max(MAX_PROPOSALS),
}).superRefine((value, context) => {
  const now = Date.now();
  const record = Date.parse(value.recordDateAt);
  const start = Date.parse(value.votingStartAt);
  const end = Date.parse(value.votingEndAt);
  if (record > now) context.addIssue({ code: 'custom', path: ['recordDateAt'], message: 'Record date cannot be in the future.' });
  if (record > start) context.addIssue({ code: 'custom', path: ['recordDateAt'], message: 'Record date must be at or before voting start.' });
  if (start >= end) context.addIssue({ code: 'custom', path: ['votingEndAt'], message: 'Voting end must be after voting start.' });
  if (end <= now + 10 * 60_000) context.addIssue({ code: 'custom', path: ['votingEndAt'], message: 'Voting must remain available for at least ten minutes.' });
  value.proposals.forEach((item, index) => {
    if (item.recommendation !== null && item.recommendation >= item.options.length) {
      context.addIssue({ code: 'custom', path: ['proposals', index, 'recommendation'], message: 'Recommendation must refer to an existing option.' });
    }
  });
});

export const voteInput = z.object({
  choices: z.array(z.number().int().min(0).max(MAX_OPTIONS - 1)).min(1).max(MAX_PROPOSALS),
  signature,
});

export const subscriptionInput = z.object({
  tokenAddress: address,
  categories: z.array(z.enum(Object.values(COMMUNICATION_CATEGORY))).min(1).max(6),
  enabled: z.boolean(),
});

const communicationContent = z.object({
  messageId: z.string().uuid(),
  category: z.enum(Object.values(COMMUNICATION_CATEGORY)),
  audience: z.enum(Object.values(COMMUNICATION_AUDIENCE)),
  title: z.string().trim().min(1).max(180),
  body: z.string().trim().min(1).max(12_000),
  actionUrl: z.string().url(),
  publishedAt: isoDate,
  expiresAt: isoDate,
});

function validateCommunicationDates(value, context) {
  const publishedAt = Date.parse(value.publishedAt);
  const expiresAt = Date.parse(value.expiresAt);

  if (expiresAt <= Math.max(Date.now(), publishedAt)) {
    context.addIssue({
      code: 'custom',
      path: ['expiresAt'],
      message: 'Expiry must be in the future and after publication.',
    });
  }
}

export const communicationDraftInput = communicationContent
  .omit({ messageId: true })
  .superRefine(validateCommunicationDates);

const signedCommunication = communicationContent
  .extend({
    chainId: z.number().int().positive(),
    eventId: z.string().uuid(),
    eventTitle: z.string().min(1).max(180),
    tokenSymbol: z.string().min(1).max(40),
    contractAddress: address,
    creatorAddress: address,
    authenticityStatus: z.enum(Object.values(AUTHENTICITY_STATUS)),
  })
  .superRefine(validateCommunicationDates);

export const communicationPublishInput = z.object({
  message: signedCommunication,
  signature,
});
