const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/gu, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));
const safeColor = (value, fallback) => /^#[0-9a-f]{6}$/iu.test(value ?? '') ? value : fallback;

function linkAt(origin, pathname) {
  const base = new URL(origin);
  if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password) {
    throw new Error('Receipt email links require an HTTP(S) origin without credentials.');
  }
  return new URL(pathname, base.origin).toString();
}

function dateLabel(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Unavailable';
  return `${date.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC`;
}

/** A message projection of the saved vote, not HTML received from the browser. */
export function receiptEmailContent({ event, vote, branding, webAppUrl, explorerUrl, hasLogo = false }) {
  if (vote.status !== 'CONFIRMED' || !vote.transaction_hash || !vote.block_number) {
    throw new Error('A confirmed transaction is required for the receipt email.');
  }
  if (!Array.isArray(event.proposals) || !Array.isArray(vote.choices) || event.proposals.length !== vote.choices.length) {
    throw new Error('Receipt selections do not match the saved proposals.');
  }
  const selections = event.proposals.map((proposal, index) => {
    const choice = vote.choices[index];
    if (!Number.isInteger(choice) || !proposal.options?.[choice]) throw new Error('A saved receipt selection is invalid.');
    const recommended = Number.isInteger(proposal.recommendation) ? proposal.options[proposal.recommendation]?.text : null;
    return { proposal: `${index + 1}. ${proposal.title}`, selected: proposal.options[choice].text, recommended: recommended ?? '-' };
  });
  const issuer = branding.issuerName || event.token_name || 'Issuer';
  const color = safeColor(branding.issuerThemeColor, '#222222');
  const ink = safeColor(branding.issuerInkColor, '#222222');
  const confirmationUrl = linkAt(webAppUrl, `/vote/${encodeURIComponent(event.id)}/confirmation`);
  const transactionUrl = linkAt(explorerUrl, `/tx/${encodeURIComponent(vote.transaction_hash)}`);
  const contractUrl = linkAt(explorerUrl, `/address/${encodeURIComponent(event.contract_address)}#code`);
  const tokenUrl = linkAt(explorerUrl, `/address/${encodeURIComponent(event.token_address)}`);
  const details = [
    ['Status', 'Confirmed on Polygon Amoy'],
    ['Investor wallet', vote.voter_address],
    ['Voting power', String(vote.voting_power)],
    ['Submitted', dateLabel(vote.created_at)],
    ['Record date', dateLabel(event.record_date_at)],
    ['Voting deadline', dateLabel(event.voting_end_at)],
    ['Tokenised stock', `${event.token_name}${event.token_symbol ? ` (${event.token_symbol})` : ''}`],
    ...(event.cusip ? [['Demo CUSIP', event.cusip]] : []),
  ];
  const detailRows = details.map(([name, value]) => `<tr><th align="left" scope="row" style="padding:9px 12px;width:160px;color:#555;font-weight:400;border-bottom:1px solid #e3e3e3;vertical-align:top">${escapeHtml(name)}</th><td style="padding:9px 12px;border-bottom:1px solid #e3e3e3;word-break:break-word">${escapeHtml(value)}</td></tr>`).join('');
  const selectionRows = selections.map((selection) => `<tr><td style="padding:12px;border-bottom:1px solid #e3e3e3;vertical-align:top">${escapeHtml(selection.proposal)}</td><td style="padding:12px;border-bottom:1px solid #e3e3e3;vertical-align:top"><strong>${escapeHtml(selection.selected)}</strong></td><td style="padding:12px;border-bottom:1px solid #e3e3e3;vertical-align:top">${escapeHtml(selection.recommended)}</td></tr>`).join('');
  const links = [ ['Open vote confirmation', confirmationUrl], ['View vote transaction', transactionUrl],
    ['View VoteEvent contract', contractUrl], ['View token contract', tokenUrl] ];
  const linkRows = links.map(([label, url]) => `<p style="margin:10px 0"><a href="${escapeHtml(url)}" style="color:#2a6ba2;text-decoration:underline">${escapeHtml(label)}</a></p>`).join('');
  const subject = `Vote receipt - ${String(event.title).replace(/[\r\n\x00-\x1f\x7f]+/gu, ' ').slice(0, 180)}`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:24px 12px;background:#f5f5f5;color:#222;font:15px/1.55 Arial,Helvetica,sans-serif">
<table role="presentation" style="width:100%;max-width:700px;margin:0 auto;background:#fff;border:1px solid #e3e3e3;border-collapse:collapse"><tr><td style="padding:28px;border-top:6px solid ${color}">
${hasLogo ? `<img src="cid:issuer-logo" width="120" alt="${escapeHtml(issuer)} logo" style="display:block;max-width:120px;height:auto;margin:0 0 20px">` : ''}
<p style="margin:0;color:${ink};font-size:18px;font-weight:700">${escapeHtml(issuer)}</p>
<h1 style="font-size:25px;line-height:1.3;margin:14px 0;color:${ink}">${escapeHtml(event.title)}</h1>
${branding.securityName ? `<p style="margin:0 0 20px;color:#555">${escapeHtml(branding.securityName)}${branding.securityTicker ? ` (${escapeHtml(branding.securityTicker)})` : ''}</p>` : ''}
<h2 style="font-size:21px;margin:20px 0 8px;color:${ink}">Thank you for voting!</h2>
<p>Your vote is confirmed on Polygon Amoy. You submitted selections for ${selections.length} of ${event.proposals.length} proposals. Confirmed votes cannot be changed.</p>
<p>Your voting receipt is attached. The selections and transaction details are also included below.</p>
<table style="width:100%;border-collapse:collapse;margin:20px 0">${detailRows}</table>
<h2 style="font-size:19px;color:${ink}">Your submitted selections</h2>
<table style="width:100%;table-layout:fixed;border-collapse:collapse"><thead><tr style="background:#f1f1f1"><th align="left" scope="col" style="width:46%;padding:10px 12px">Proposal</th><th align="left" scope="col" style="width:27%;padding:10px 12px">Selected option</th><th align="left" scope="col" style="padding:10px 12px">Board recommendation</th></tr></thead><tbody>${selectionRows}</tbody></table>
<div style="margin-top:24px">${linkRows}</div>
<p style="font-size:12px;color:#666">Opening the confirmation page may require signing in with the investor wallet.</p>
<p style="margin:26px 0 0;padding-top:14px;border-top:1px solid #ddd;color:#666;font-size:12px">Powered by Broadridge</p>
</td></tr></table></body></html>`;
  const text = [issuer, event.title, branding.securityName || '', '', 'Thank you for voting!',
    'Your vote is confirmed on Polygon Amoy. Confirmed votes cannot be changed.',
    'Your PDF voting receipt is attached.', '', ...details.map(([name, value]) => `${name}: ${value}`), '',
    'Your submitted selections', ...selections.map((s) => `${s.proposal}\nSelected option: ${s.selected}\nBoard recommendation: ${s.recommended}\n`),
    ...links.map(([label, url]) => `${label}: ${url}`), '', 'Powered by Broadridge'].join('\n');
  return { subject, html, text };
}
