import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { formatUnits } from 'ethers';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { query } from './db.js';
import { readAllEventDocuments } from './documents.js';
import { HttpError, normalizeAddress } from './errors.js';
import { eventResults, getEventRow } from './events.js';

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 42;
const HEADER_HEIGHT = 68;
const NAVY = rgb(0.02, 0.13, 0.29);
const BLUE = rgb(0.08, 0.34, 0.65);
const TEXT = rgb(0.11, 0.14, 0.18);
const MUTED = rgb(0.39, 0.43, 0.49);
const LINE = rgb(0.87, 0.89, 0.92);
const LIGHT = rgb(0.96, 0.97, 0.98);
const logoPath = fileURLToPath(new URL('../assets/broadridge-logo-white.png', import.meta.url));

function safeFilename(value) {
  return String(value ?? 'report')
    .normalize('NFKC')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'report';
}

function formatDate(value) {
  return new Date(value).toLocaleString('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }) + ' UTC';
}

function formatToken(value, decimals, symbol) {
  const formatted = formatUnits(BigInt(value), decimals);
  const [whole, fraction = ''] = formatted.split('.');
  const compactFraction = fraction.replace(/0+$/, '').slice(0, 6);
  return `${whole}${compactFraction ? `.${compactFraction}` : ''} ${symbol}`;
}

function optionText(proposal, choice) {
  return proposal.options[Number(choice)]?.text ?? `Option ${Number(choice) + 1}`;
}

function pdfText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[‐-―]/gu, '-')
    .replace(/[‘’]/gu, "'")
    .replace(/[“”]/gu, '"')
    .replace(/…/gu, '...')
    .replace(/•/gu, '-')
    .replace(/[^ -~]/gu, '?');
}

function splitToWidth(word, font, size, width) {
  const chunks = [];
  let chunk = '';
  for (const character of word) {
    const candidate = `${chunk}${character}`;
    if (chunk && font.widthOfTextAtSize(candidate, size) > width) {
      chunks.push(chunk);
      chunk = character;
    } else {
      chunk = candidate;
    }
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

function wrapText(text, font, size, width) {
  const words = pdfText(text).replace(/\s+/gu, ' ').trim().split(' ').filter(Boolean);
  if (!words.length) return [''];

  const lines = [];
  let line = '';
  for (const rawWord of words) {
    const parts = font.widthOfTextAtSize(rawWord, size) > width
      ? splitToWidth(rawWord, font, size, width)
      : [rawWord];
    for (const part of parts) {
      const candidate = line ? `${line} ${part}` : part;
      if (line && font.widthOfTextAtSize(candidate, size) > width) {
        lines.push(line);
        line = part;
      } else {
        line = candidate;
      }
    }
  }
  if (line) lines.push(line);
  return lines;
}

class ReportWriter {
  constructor(document, fonts, logo, reportTitle, reportSubtitle) {
    this.document = document;
    this.fonts = fonts;
    this.logo = logo;
    this.reportTitle = pdfText(reportTitle);
    this.reportSubtitle = pdfText(reportSubtitle);
    this.page = null;
    this.y = 0;
    this.reportPages = [];
    this.addPage();
  }

  static async create(document, title, subtitle) {
    const [regular, bold, logoBytes] = await Promise.all([
      document.embedFont(StandardFonts.Helvetica),
      document.embedFont(StandardFonts.HelveticaBold),
      readFile(logoPath),
    ]);
    const logo = await document.embedPng(logoBytes);
    return new ReportWriter(document, { regular, bold }, logo, title, subtitle);
  }

  addPage() {
    this.page = this.document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.reportPages.push(this.page);
    this.page.drawRectangle({ x: 0, y: PAGE_HEIGHT - HEADER_HEIGHT, width: PAGE_WIDTH, height: HEADER_HEIGHT, color: NAVY });
    const logoWidth = 166;
    const logoHeight = logoWidth * (this.logo.height / this.logo.width);
    this.page.drawImage(this.logo, {
      x: MARGIN,
      y: PAGE_HEIGHT - HEADER_HEIGHT / 2 - logoHeight / 2,
      width: logoWidth,
      height: logoHeight,
    });
    this.page.drawText(this.reportTitle, {
      x: PAGE_WIDTH - MARGIN - this.fonts.bold.widthOfTextAtSize(this.reportTitle, 12),
      y: PAGE_HEIGHT - 30,
      size: 12,
      font: this.fonts.bold,
      color: rgb(1, 1, 1),
    });
    if (this.reportSubtitle) {
      this.page.drawText(this.reportSubtitle, {
        x: PAGE_WIDTH - MARGIN - this.fonts.regular.widthOfTextAtSize(this.reportSubtitle, 8),
        y: PAGE_HEIGHT - 45,
        size: 8,
        font: this.fonts.regular,
        color: rgb(0.82, 0.87, 0.94),
      });
    }
    this.y = PAGE_HEIGHT - HEADER_HEIGHT - 28;
  }

  ensure(height) {
    if (this.y - height < 48) this.addPage();
  }

  heading(text, size = 15) {
    this.ensure(size + 18);
    this.page.drawText(pdfText(text), { x: MARGIN, y: this.y, size, font: this.fonts.bold, color: NAVY });
    this.y -= size + 10;
  }

  paragraph(text, { size = 9.5, color = TEXT, gap = 10 } = {}) {
    const lines = wrapText(text, this.fonts.regular, size, PAGE_WIDTH - 2 * MARGIN);
    const lineHeight = size * 1.35;
    this.ensure(lines.length * lineHeight + gap);
    for (const line of lines) {
      this.page.drawText(line, { x: MARGIN, y: this.y, size, font: this.fonts.regular, color });
      this.y -= lineHeight;
    }
    this.y -= gap;
  }

  keyValues(rows) {
    const labelWidth = 142;
    for (const [label, value] of rows) {
      const lines = wrapText(String(value ?? '-'), this.fonts.regular, 9, PAGE_WIDTH - 2 * MARGIN - labelWidth);
      const height = Math.max(18, lines.length * 12 + 6);
      this.ensure(height);
      this.page.drawText(pdfText(label), { x: MARGIN, y: this.y, size: 9, font: this.fonts.bold, color: MUTED });
      lines.forEach((line, index) => {
        this.page.drawText(line, {
          x: MARGIN + labelWidth,
          y: this.y - index * 12,
          size: 9,
          font: this.fonts.regular,
          color: TEXT,
        });
      });
      this.y -= height;
    }
    this.y -= 6;
  }

  callout(label, value) {
    this.ensure(64);
    this.page.drawRectangle({ x: MARGIN, y: this.y - 48, width: PAGE_WIDTH - 2 * MARGIN, height: 56, color: LIGHT, borderColor: LINE, borderWidth: 1 });
    this.page.drawText(pdfText(label), { x: MARGIN + 14, y: this.y - 10, size: 9, font: this.fonts.bold, color: MUTED });
    this.page.drawText(pdfText(value), { x: MARGIN + 14, y: this.y - 34, size: 18, font: this.fonts.bold, color: NAVY });
    this.y -= 68;
  }

  table(headers, rows, widths) {
    const totalWidth = PAGE_WIDTH - 2 * MARGIN;
    const actualWidths = widths.map((width) => width * totalWidth);
    const drawHeader = () => {
      this.ensure(26);
      this.page.drawRectangle({ x: MARGIN, y: this.y - 18, width: totalWidth, height: 24, color: NAVY });
      let x = MARGIN + 6;
      headers.forEach((header, index) => {
        this.page.drawText(pdfText(header), { x, y: this.y - 10, size: 8, font: this.fonts.bold, color: rgb(1, 1, 1) });
        x += actualWidths[index];
      });
      this.y -= 26;
    };

    drawHeader();
    for (const row of rows) {
      const cellLines = row.map((value, index) => wrapText(String(value ?? '-'), this.fonts.regular, 7.5, actualWidths[index] - 10));
      const rowHeight = Math.max(22, Math.max(...cellLines.map((lines) => lines.length)) * 10 + 8);
      if (this.y - rowHeight < 48) { this.addPage(); drawHeader(); }
      this.page.drawRectangle({ x: MARGIN, y: this.y - rowHeight + 4, width: totalWidth, height: rowHeight, color: rgb(1, 1, 1), borderColor: LINE, borderWidth: 0.5 });
      let x = MARGIN + 6;
      cellLines.forEach((lines, index) => {
        lines.forEach((line, lineIndex) => this.page.drawText(line, {
          x,
          y: this.y - 8 - lineIndex * 10,
          size: 7.5,
          font: this.fonts.regular,
          color: TEXT,
        }));
        x += actualWidths[index];
      });
      this.y -= rowHeight;
    }
    this.y -= 12;
  }

  finishFooters() {
    this.reportPages.forEach((page, index) => {
      page.drawLine({ start: { x: MARGIN, y: 33 }, end: { x: PAGE_WIDTH - MARGIN, y: 33 }, color: LINE, thickness: 0.5 });
      page.drawText('Broadridge Proxy Voting - Confidential', { x: MARGIN, y: 20, size: 7, font: this.fonts.regular, color: MUTED });
      const pageText = `Page ${index + 1} of ${this.reportPages.length}`;
      page.drawText(pageText, {
        x: PAGE_WIDTH - MARGIN - this.fonts.regular.widthOfTextAtSize(pageText, 7),
        y: 20,
        size: 7,
        font: this.fonts.regular,
        color: MUTED,
      });
    });
  }
}

async function viewerContext(eventId, walletInput) {
  const wallet = normalizeAddress(walletInput, 'wallet');
  const result = await query(
    `SELECT e.*,to_jsonb(v) AS viewer_vote
       FROM events e
       LEFT JOIN votes v
         ON v.event_id=e.id AND v.voter_address=$2 AND v.status='CONFIRMED'
      WHERE e.id=$1`,
    [eventId, wallet],
  );
  if (!result.rowCount) throw new HttpError(404, 'Event not found.', 'EVENT_NOT_FOUND');
  const event = result.rows[0];
  const creator = event.creator_address === wallet;
  if (!creator && !event.viewer_vote) {
    throw new HttpError(403, 'This report is available only to the event creator and confirmed voters.', 'REPORT_FORBIDDEN');
  }
  return { event, wallet, creator, vote: event.viewer_vote };
}

function eventDetails(event) {
  return [
    ['Event', event.title],
    ['Token', `${event.token_name} (${event.token_symbol})`],
    ['Token address', event.token_address],
    ['Creator', event.creator_address],
    ['Record date', formatDate(event.record_date_at)],
    ['Voting period', `${formatDate(event.voting_start_at)} - ${formatDate(event.voting_end_at)}`],
    ['Token-to-vote ratio', `${event.token_to_vote_ratio} token(s) per vote`],
    ['VoteEvent contract', event.contract_address ?? 'Not deployed'],
  ];
}

async function appendSupportingDocuments(target, documents) {
  for (const document of documents) {
    const source = await PDFDocument.load(document.bytes, { updateMetadata: false });
    const pages = await target.copyPages(source, source.getPageIndices());
    pages.forEach((page) => target.addPage(page));
  }
}

export async function createResultsReport(eventId, walletInput) {
  const context = await viewerContext(eventId, walletInput);
  const result = await eventResults(eventId, context.wallet);
  const [participationResult, holdersResult, documents] = await Promise.all([
    query(
      `SELECT
         (SELECT count(*)::int FROM snapshot_entries WHERE event_id=$1) AS eligible_holders,
         (SELECT coalesce(sum(voting_power),0)::text FROM snapshot_entries WHERE event_id=$1) AS eligible_power,
         (SELECT count(*)::int FROM votes WHERE event_id=$1 AND status='CONFIRMED') AS ballots_cast,
         (SELECT coalesce(sum(voting_power),0)::text FROM votes WHERE event_id=$1 AND status='CONFIRMED') AS power_cast`,
      [eventId],
    ),
    context.creator
      ? query(
          `SELECT se.wallet_address,se.raw_balance,se.voting_power,v.status,v.choices
             FROM snapshot_entries se
             LEFT JOIN votes v ON v.event_id=se.event_id AND v.voter_address=se.wallet_address
            WHERE se.event_id=$1
            ORDER BY se.voting_power DESC,se.wallet_address`,
          [eventId],
        )
      : Promise.resolve({ rows: [] }),
    readAllEventDocuments(eventId),
  ]);

  const participation = participationResult.rows[0];
  const eligiblePower = BigInt(participation.eligible_power);
  const powerCast = BigInt(participation.power_cast);
  const turnout = eligiblePower === 0n ? 0 : Number((powerCast * 10_000n) / eligiblePower) / 100;

  const pdf = await PDFDocument.create();
  const writer = await ReportWriter.create(pdf, 'Proxy Voting Results Report', context.event.token_symbol);
  writer.heading(context.event.title, 18);
  writer.paragraph(context.event.description || 'Final proxy voting report.', { color: MUTED });
  writer.heading('Event details');
  writer.keyValues(eventDetails(context.event));
  writer.heading('Participation');
  writer.keyValues([
    ['Eligible token holders', participation.eligible_holders],
    ['Eligible voting power', participation.eligible_power],
    ['Confirmed ballots', participation.ballots_cast],
    ['Voting power cast', participation.power_cast],
    ['Voting-power turnout', `${turnout.toFixed(2)}%`],
  ]);

  writer.heading('Proposal results');
  result.proposals.forEach((proposal, proposalIndex) => {
    writer.heading(`${proposalIndex + 1}. ${proposal.title}`, 12);
    if (proposal.description) writer.paragraph(proposal.description, { size: 8.5, color: MUTED, gap: 5 });
    const total = proposal.tallies.reduce((sum, value) => sum + BigInt(value), 0n);
    writer.table(
      ['Option', 'Board recommendation', 'Voting power', 'Percentage'],
      proposal.options.map((option, optionIndex) => {
        const value = BigInt(proposal.tallies[optionIndex]);
        const percent = total === 0n ? 0 : Number((value * 10_000n) / total) / 100;
        return [
          option.text,
          proposal.recommendation === optionIndex ? 'Recommended' : '-',
          value.toString(),
          `${percent.toFixed(2)}%`,
        ];
      }),
      [0.42, 0.23, 0.18, 0.17],
    );
  });

  if (context.creator) {
    writer.heading('Record-date holder register');
    writer.paragraph('Holdings and voting power are taken from the final record-date snapshot.', { size: 8.5, color: MUTED });
    writer.table(
      ['Wallet', 'Record-date holding', 'Voting power', 'Participation'],
      holdersResult.rows.map((holder) => [
        holder.wallet_address,
        formatToken(holder.raw_balance, context.event.token_decimals, context.event.token_symbol),
        String(holder.voting_power),
        holder.status === 'CONFIRMED' ? 'Voted' : 'Not voted',
      ]),
      [0.42, 0.24, 0.16, 0.18],
    );
  } else {
    writer.heading('Your participation');
    writer.callout('Voting power', context.vote.voting_power);
    writer.table(
      ['Proposal', 'Selected option'],
      context.event.proposals.map((proposal, index) => [
        proposal.title,
        optionText(proposal, context.vote.choices[index]),
      ]),
      [0.58, 0.42],
    );
  }

  if (documents.length) {
    writer.heading('Supporting documents');
    writer.paragraph('The following organiser-provided proxy voting documents are appended to this report.');
    writer.table(
      ['Document', 'Pages', 'SHA-256'],
      documents.map((document) => [document.fileName, document.pageCount, document.sha256]),
      [0.45, 0.1, 0.45],
    );
  }

  writer.finishFooters();
  await appendSupportingDocuments(pdf, documents);
  const bytes = await pdf.save();
  return {
    bytes: Buffer.from(bytes),
    filename: `${safeFilename(context.event.title)}-results.pdf`,
  };
}

export async function createVoteReceipt(eventId, walletInput) {
  const wallet = normalizeAddress(walletInput, 'wallet');
  const event = await getEventRow(eventId);
  const voteResult = await query(
    `SELECT * FROM votes
      WHERE event_id=$1 AND voter_address=$2 AND status<>'FAILED'`,
    [eventId, wallet],
  );
  if (!voteResult.rowCount) {
    throw new HttpError(404, 'No vote receipt exists for this wallet.', 'RECEIPT_NOT_FOUND');
  }
  const vote = voteResult.rows[0];

  const pdf = await PDFDocument.create();
  const writer = await ReportWriter.create(pdf, 'Proxy Voting Receipt', event.token_symbol);
  writer.heading(event.title, 18);
  writer.paragraph('Receipt of submitted proxy voting instructions.', { color: MUTED });
  writer.heading('Event details');
  writer.keyValues(eventDetails(event));
  writer.heading('Voter details');
  writer.keyValues([
    ['Wallet', wallet],
    ['Status', vote.status],
    ['Transaction', vote.transaction_hash ?? 'Queued for relayer submission'],
    ['Submitted', formatDate(vote.created_at)],
  ]);
  writer.callout('Voting power', vote.voting_power);
  writer.heading('Selected options');
  writer.table(
    ['Proposal', 'Selected option', 'Board recommendation'],
    event.proposals.map((proposal, index) => [
      proposal.title,
      optionText(proposal, vote.choices[index]),
      proposal.recommendation === null || proposal.recommendation === undefined
        ? '-'
        : optionText(proposal, proposal.recommendation),
    ]),
    [0.43, 0.34, 0.23],
  );
  writer.finishFooters();

  const bytes = await pdf.save();
  return {
    bytes: Buffer.from(bytes),
    filename: `${safeFilename(event.title)}-vote-receipt.pdf`,
  };
}
