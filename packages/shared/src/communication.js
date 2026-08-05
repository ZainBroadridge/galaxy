import { keccak256, toUtf8Bytes } from 'ethers';

function oneLine(value) {
  return String(value ?? '').trim().replace(/\r?\n/g, ' ');
}

export function communicationBodyHash(body) {
  return keccak256(toUtf8Bytes(String(body ?? '').replace(/\r\n/g, '\n')));
}

/**
 * Exact human-readable message signed by an event creator.
 * Kept as V2 so already-published event communications remain verifiable.
 */
export function buildCommunicationSigningMessage(message) {
  return [
    'PV_COMMUNICATION_V2',
    `chainId:${oneLine(message.chainId)}`,
    `eventId:${oneLine(message.eventId)}`,
    `eventTitle:${oneLine(message.eventTitle)}`,
    `tokenSymbol:${oneLine(message.tokenSymbol)}`,
    `contract:${oneLine(message.contractAddress).toLowerCase()}`,
    `creator:${oneLine(message.creatorAddress).toLowerCase()}`,
    `authenticityStatus:${oneLine(message.authenticityStatus)}`,
    `messageId:${oneLine(message.messageId)}`,
    `title:${oneLine(message.title)}`,
    `bodyHash:${communicationBodyHash(message.body)}`,
    `category:${oneLine(message.category)}`,
    `audience:${oneLine(message.audience)}`,
    `publishedAt:${oneLine(message.publishedAt)}`,
    `expiresAt:${oneLine(message.expiresAt)}`,
    `actionUrl:${oneLine(message.actionUrl)}`,
  ].join('\n');
}

/**
 * Exact message signed for token-level news that is independent of a vote.
 */
export function buildTokenCommunicationSigningMessage(message) {
  return [
    'PV_TOKEN_COMMUNICATION_V1',
    `chainId:${oneLine(message.chainId)}`,
    `tokenAddress:${oneLine(message.tokenAddress).toLowerCase()}`,
    `tokenName:${oneLine(message.tokenName)}`,
    `tokenSymbol:${oneLine(message.tokenSymbol)}`,
    `creator:${oneLine(message.creatorAddress).toLowerCase()}`,
    `authenticityStatus:${oneLine(message.authenticityStatus)}`,
    `messageId:${oneLine(message.messageId)}`,
    `title:${oneLine(message.title)}`,
    `bodyHash:${communicationBodyHash(message.body)}`,
    `category:${oneLine(message.category)}`,
    `audience:${oneLine(message.audience)}`,
    `publishedAt:${oneLine(message.publishedAt)}`,
    `expiresAt:${oneLine(message.expiresAt)}`,
    `actionUrl:${oneLine(message.actionUrl)}`,
  ].join('\n');
}
