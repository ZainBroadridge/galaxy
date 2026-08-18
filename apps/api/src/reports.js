import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { formatUnits } from 'ethers';
import { PDFDocument, PDFName, PDFString, StandardFonts, rgb } from 'pdf-lib';
import { config } from './config.js';
import { query } from './db.js';
import { readAllEventDocuments } from './documents.js';
import { HttpError, normalizeAddress } from './errors.js';
import { eventResults, getEventRow } from './events.js';

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 42;
const HEADER_HEIGHT = 68;
const CONTENT_BOTTOM = 48;
const CONTENT_TOP = PAGE_HEIGHT - HEADER_HEIGHT - 28;
const CONTENT_HEIGHT = CONTENT_TOP - CONTENT_BOTTOM;
const NAVY = rgb(0.02, 0.13, 0.29);
const LINK_BLUE = rgb(0, 0.33, 0.88);
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

function httpUrl(value) {
  try {
    const parsed = new URL(String(value));
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function explorerPath(path) {
  const base = String(config.explorerUrl ?? '').replace(/\/+$/gu, '');
  return base ? httpUrl(`${base}/${String(path).replace(/^\/+/gu, '')}`) : null;
}

function linkedValue(text, url) {
  return {
    text: String(text ?? ''),
    url: httpUrl(url),
    linkStyle: true,
  };
}

function valueDescriptor(value) {
  if (value && typeof value === 'object' && !Array.isArray(value) && 'text' in value) {
    const url = httpUrl(value.url);
    return {
      text: String(value.text ?? '-'),
      url,
      linkStyle: value.linkStyle === true || Boolean(url),
    };
  }

  const text = String(value ?? '-');
  const url = httpUrl(text);
  return { text, url, linkStyle: Boolean(url) };
}

function addressValue(address, url = null) {
  return address
    ? linkedValue(address, url ?? explorerPath(`address/${address}`))
    : 'Not deployed';
}

function transactionValue(hash) {
  return hash
    ? linkedValue(hash, explorerPath(`tx/${hash}`))
    : 'Queued for relayer submission';
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
    this.y = CONTENT_TOP;
  }

  ensure(height) {
    const required = Math.min(Math.max(0, height), CONTENT_HEIGHT);
    if (this.y - required < CONTENT_BOTTOM) this.addPage();
  }

  heading(text, size = 15, keepWithNext = 0) {
    this.ensure(size + 10 + keepWithNext);
    this.page.drawText(pdfText(text), { x: MARGIN, y: this.y, size, font: this.fonts.bold, color: NAVY });
    this.y -= size + 10;
  }

  paragraphHeight(text, { size = 9.5, gap = 10 } = {}) {
    const lines = wrapText(text, this.fonts.regular, size, PAGE_WIDTH - 2 * MARGIN);
    return lines.length * size * 1.35 + gap;
  }

  paragraph(text, { size = 9.5, color = TEXT, gap = 10 } = {}) {
    const lines = wrapText(text, this.fonts.regular, size, PAGE_WIDTH - 2 * MARGIN);
    const lineHeight = size * 1.35;
    const totalHeight = lines.length * lineHeight + gap;

    if (totalHeight <= CONTENT_HEIGHT) {
      this.ensure(totalHeight);
      for (const line of lines) {
        this.page.drawText(line, { x: MARGIN, y: this.y, size, font: this.fonts.regular, color });
        this.y -= lineHeight;
      }
      this.y -= gap;
      return;
    }

    for (const line of lines) {
      if (this.y - lineHeight < CONTENT_BOTTOM) this.addPage();
      this.page.drawText(line, { x: MARGIN, y: this.y, size, font: this.fonts.regular, color });
      this.y -= lineHeight;
    }
    if (this.y - gap < CONTENT_BOTTOM) this.addPage();
    else this.y -= gap;
  }

  keyValueLayouts(rows) {
    const labelWidth = 142;
    const valueWidth = PAGE_WIDTH - 2 * MARGIN - labelWidth;
    return rows.map(([label, value]) => {
      const descriptor = valueDescriptor(value);
      const lines = wrapText(descriptor.text, this.fonts.regular, 9, valueWidth);
      return {
        label,
        ...descriptor,
        lines,
        height: Math.max(18, lines.length * 12 + 6),
      };
    });
  }

  keyValuesHeight(rows) {
    return this.keyValueLayouts(rows).reduce((sum, row) => sum + row.height, 6);
  }

  addLinkAnnotation({ x, y, width, height, url }) {
    if (!url || width <= 0 || height <= 0) return;
    const annotation = this.document.context.obj({
      Type: PDFName.of('Annot'),
      Subtype: PDFName.of('Link'),
      Rect: [x, y, x + width, y + height],
      Border: [0, 0, 0],
      H: PDFName.of('I'),
      A: {
        Type: PDFName.of('Action'),
        S: PDFName.of('URI'),
        URI: PDFString.of(url),
      },
    });
    this.page.node.addAnnot(this.document.context.register(annotation));
  }

  drawValueLine(text, {
    x, y, size, font, url = null, linkStyle = false,
  }) {
    const styledAsLink = linkStyle || Boolean(url);
    this.page.drawText(text, {
      x,
      y,
      size,
      font,
      color: styledAsLink ? LINK_BLUE : TEXT,
    });
    if (!styledAsLink || !text) return;

    const width = font.widthOfTextAtSize(text, size);
    const height = font.heightAtSize(size);
    this.page.drawLine({
      start: { x, y: y - 1.35 },
      end: { x: x + width, y: y - 1.35 },
      thickness: 0.7,
      color: LINK_BLUE,
    });
    if (url) this.addLinkAnnotation({ x, y: y - 2, width, height: height + 3, url });
  }

  keyValues(rows) {
    const labelWidth = 142;
    const layouts = this.keyValueLayouts(rows);
    const totalHeight = layouts.reduce((sum, row) => sum + row.height, 6);
    if (totalHeight <= CONTENT_HEIGHT) this.ensure(totalHeight);

    for (const row of layouts) {
      this.ensure(row.height);
      this.page.drawText(pdfText(row.label), { x: MARGIN, y: this.y, size: 9, font: this.fonts.bold, color: MUTED });
      row.lines.forEach((line, index) => this.drawValueLine(line, {
        x: MARGIN + labelWidth,
        y: this.y - index * 12,
        size: 9,
        font: this.fonts.regular,
        url: row.url,
        linkStyle: row.linkStyle,
      }));
      this.y -= row.height;
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

  tableLayouts(rows, widths) {
    const totalWidth = PAGE_WIDTH - 2 * MARGIN;
    const actualWidths = widths.map((width) => width * totalWidth);
    const layouts = rows.map((row) => {
      const cells = row.map((value, index) => {
        const descriptor = valueDescriptor(value);
        return {
          ...descriptor,
          lines: wrapText(descriptor.text, this.fonts.regular, 7.5, actualWidths[index] - 10),
        };
      });
      return {
        cells,
        height: Math.max(22, Math.max(...cells.map((cell) => cell.lines.length)) * 10 + 8),
      };
    });
    return { totalWidth, actualWidths, layouts };
  }

  tableStartHeight(rows, widths) {
    const { layouts } = this.tableLayouts(rows, widths);
    return 26 + (layouts[0]?.height ?? 0);
  }

  table(headers, rows, widths) {
    const { totalWidth, actualWidths, layouts } = this.tableLayouts(rows, widths);
    const drawHeader = () => {
      this.page.drawRectangle({ x: MARGIN, y: this.y - 18, width: totalWidth, height: 24, color: NAVY });
      let x = MARGIN + 6;
      headers.forEach((header, index) => {
        this.page.drawText(pdfText(header), { x, y: this.y - 10, size: 8, font: this.fonts.bold, color: rgb(1, 1, 1) });
        x += actualWidths[index];
      });
      this.y -= 26;
    };

    this.ensure(26 + (layouts[0]?.height ?? 0));
    drawHeader();
    for (const row of layouts) {
      if (this.y - row.height < CONTENT_BOTTOM) {
        this.addPage();
        drawHeader();
      }
      this.page.drawRectangle({ x: MARGIN, y: this.y - row.height + 4, width: totalWidth, height: row.height, color: rgb(1, 1, 1), borderColor: LINE, borderWidth: 0.5 });
      let x = MARGIN + 6;
      row.cells.forEach((cell, index) => {
        cell.lines.forEach((line, lineIndex) => this.drawValueLine(line, {
          x,
          y: this.y - 8 - lineIndex * 10,
          size: 7.5,
          font: this.fonts.regular,
          url: cell.url,
          linkStyle: cell.linkStyle,
        }));
        x += actualWidths[index];
      });
      this.y -= row.height;
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
  const contractUrl = event.contract_address
    ? (verifiedContractUrl(event) ?? explorerPath(`address/${event.contract_address}`))
    : null;
  return [
    ['Event', event.title],
    ['Token', `${event.token_name} (${event.token_symbol})`],
    ['Token address', addressValue(event.token_address)],
    ['Creator', addressValue(event.creator_address)],
    ['Record date', formatDate(event.record_date_at)],
    ['Voting period', `${formatDate(event.voting_start_at)} - ${formatDate(event.voting_end_at)}`],
    ['Token-to-vote ratio', `${event.token_to_vote_ratio} token(s) per vote`],
    ['VoteEvent contract', addressValue(event.contract_address, contractUrl)],
    ...(contractUrl ? [['Verified VoteEvent URL', linkedValue(contractUrl, contractUrl)]] : []),
  ];
}

function verifiedContractUrl(event) {
  if (event.verification_status !== 'VERIFIED' || !event.contract_address) return null;
  return `${config.explorerUrl}/address/${event.contract_address}#code`;
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
  const introduction = context.event.description || 'Final proxy voting report.';
  writer.heading(context.event.title, 18, writer.paragraphHeight(introduction, { size: 9.5, gap: 10 }));
  writer.paragraph(introduction, { color: MUTED });

  const detailRows = eventDetails(context.event);
  writer.heading('Event details', 15, writer.keyValuesHeight(detailRows));
  writer.keyValues(detailRows);

  const participationRows = [
    ['Eligible token holders', participation.eligible_holders],
    ['Eligible voting power', participation.eligible_power],
    ['Confirmed ballots', participation.ballots_cast],
    ['Voting power cast', participation.power_cast],
    ['Voting-power turnout', `${turnout.toFixed(2)}%`],
  ];
  writer.heading('Participation', 15, writer.keyValuesHeight(participationRows));
  writer.keyValues(participationRows);

  const proposalWidths = [0.42, 0.23, 0.18, 0.17];
  const proposalBlocks = result.proposals.map((proposal, proposalIndex) => {
    const total = proposal.tallies.reduce((sum, value) => sum + BigInt(value), 0n);
    const rows = proposal.options.map((option, optionIndex) => {
      const value = BigInt(proposal.tallies[optionIndex]);
      const percent = total === 0n ? 0 : Number((value * 10_000n) / total) / 100;
      return [
        option.text,
        proposal.recommendation === optionIndex ? 'Recommended' : '-',
        value.toString(),
        `${percent.toFixed(2)}%`,
      ];
    });
    const descriptionHeight = proposal.description
      ? writer.paragraphHeight(proposal.description, { size: 8.5, gap: 5 })
      : 0;
    return {
      proposal,
      proposalIndex,
      rows,
      keepHeight: 22 + descriptionHeight + writer.tableStartHeight(rows, proposalWidths),
      descriptionHeight,
    };
  });

  writer.heading('Proposal results', 15, proposalBlocks[0]?.keepHeight ?? 0);
  proposalBlocks.forEach(({ proposal, proposalIndex, rows, descriptionHeight }) => {
    writer.heading(
      `${proposalIndex + 1}. ${proposal.title}`,
      12,
      descriptionHeight + writer.tableStartHeight(rows, proposalWidths),
    );
    if (proposal.description) writer.paragraph(proposal.description, { size: 8.5, color: MUTED, gap: 5 });
    writer.table(
      ['Option', 'Board recommendation', 'Voting power', 'Percentage'],
      rows,
      proposalWidths,
    );
  });

  if (context.creator) {
    const holderRows = holdersResult.rows.map((holder) => [
      addressValue(holder.wallet_address),
      formatToken(holder.raw_balance, context.event.token_decimals, context.event.token_symbol),
      String(holder.voting_power),
      holder.status === 'CONFIRMED' ? 'Voted' : 'Not voted',
    ]);
    const holderWidths = [0.42, 0.24, 0.16, 0.18];
    const holderIntro = 'Holdings and voting power are taken from the final record-date snapshot.';
    writer.heading(
      'Record-date holder register',
      15,
      writer.paragraphHeight(holderIntro, { size: 8.5, gap: 10 }) + writer.tableStartHeight(holderRows, holderWidths),
    );
    writer.paragraph(holderIntro, { size: 8.5, color: MUTED });
    writer.table(
      ['Wallet', 'Record-date holding', 'Voting power', 'Participation'],
      holderRows,
      holderWidths,
    );
  } else {
    const participationRowsForViewer = context.event.proposals.map((proposal, index) => [
      proposal.title,
      optionText(proposal, context.vote.choices[index]),
    ]);
    const viewerWidths = [0.58, 0.42];
    writer.heading(
      'Your participation',
      15,
      68 + writer.tableStartHeight(participationRowsForViewer, viewerWidths),
    );
    writer.callout('Voting power', context.vote.voting_power);
    writer.table(
      ['Proposal', 'Selected option'],
      participationRowsForViewer,
      viewerWidths,
    );
  }

  if (documents.length) {
    const documentRows = documents.map((document) => [document.fileName, document.pageCount, document.sha256]);
    const documentWidths = [0.45, 0.1, 0.45];
    const documentIntro = 'The following organiser-provided proxy voting documents are appended to this report.';
    writer.heading(
      'Supporting documents',
      15,
      writer.paragraphHeight(documentIntro) + writer.tableStartHeight(documentRows, documentWidths),
    );
    writer.paragraph(documentIntro);
    writer.table(
      ['Document', 'Pages', 'SHA-256'],
      documentRows,
      documentWidths,
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
  const contractUrl = verifiedContractUrl(event);
  if (!contractUrl) {
    throw new HttpError(409, 'The vote receipt is available after the VoteEvent contract is verified on PolygonScan.', 'RECEIPT_NOT_READY');
  }
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
  const receiptIntroduction = 'Receipt of submitted proxy voting instructions.';
  writer.heading(event.title, 18, writer.paragraphHeight(receiptIntroduction));
  writer.paragraph(receiptIntroduction, { color: MUTED });

  const detailRows = eventDetails(event);
  writer.heading('Event details', 15, writer.keyValuesHeight(detailRows));
  writer.keyValues(detailRows);

  const voterRows = [
    ['Wallet', addressValue(wallet)],
    ['Status', vote.status],
    ['Transaction', transactionValue(vote.transaction_hash)],
    ['Submitted', formatDate(vote.created_at)],
  ];
  writer.heading('Voter details', 15, writer.keyValuesHeight(voterRows) + 68);
  writer.keyValues(voterRows);
  writer.callout('Voting power', vote.voting_power);

  const selectedRows = event.proposals.map((proposal, index) => [
    proposal.title,
    optionText(proposal, vote.choices[index]),
    proposal.recommendation === null || proposal.recommendation === undefined
      ? '-'
      : optionText(proposal, proposal.recommendation),
  ]);
  const selectedWidths = [0.43, 0.34, 0.23];
  writer.heading('Selected options', 15, writer.tableStartHeight(selectedRows, selectedWidths));
  writer.table(
    ['Proposal', 'Selected option', 'Board recommendation'],
    selectedRows,
    selectedWidths,
  );
  writer.finishFooters();

  const bytes = await pdf.save();
  return {
    bytes: Buffer.from(bytes),
    filename: `${safeFilename(event.title)}-vote-receipt.pdf`,
  };
}
