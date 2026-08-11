import { getAddress, verifyMessage } from 'ethers';
import { buildCommunicationSigningMessage, buildTokenCommunicationSigningMessage } from '@pv/shared';
import { api } from './api.js';

export function verifyCommunications(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.filter((message) => {
    try {
      const signingMessage = message.scope === 'TOKEN'
        ? buildTokenCommunicationSigningMessage(message)
        : buildCommunicationSigningMessage(message);
      return getAddress(verifyMessage(signingMessage, message.signature)).toLowerCase()
        === getAddress(message.creatorAddress).toLowerCase();
    } catch {
      return false;
    }
  });
}

export async function fetchCommunications(walletAddress) {
  const query = new URLSearchParams({ wallet: walletAddress });
  const messages = await api(`/v1/communications/inbox?${query}`, { auth: false });
  return verifyCommunications(messages);
}
