import { Fragment, useId } from 'react';
import { Link } from 'react-router-dom';
import { API_BASE_URL } from '../api.js';
import { ArrowIcon, DocumentIcon } from './InvestorFrame.jsx';

function DocumentName({ fileName }) {
  return <span className="investor-document-name">{fileName.split(/([_-])/u).map((part, index) => (
    <Fragment key={index}>{part}{part === '_' || part === '-' ? <wbr /> : null}</Fragment>
  ))}</span>;
}

/** Shared meeting attachments; each page supplies wording appropriate to its stage. */
export default function EventDocuments({ event, heading = 'Documents to Review Before You Vote:' }) {
  const headingId = useId();
  const documents = event?.documents ?? [];
  if (!documents.length) return null;

  return <section className="investor-documents" aria-labelledby={headingId}>
    <h2 id={headingId}>
      <span>{heading}</span>
      <Link className="investor-help-link" to="/education" aria-label="Learn about proxy voting documents">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 5" /><circle cx="12" cy="18" r="1" />
        </svg>
      </Link>
    </h2>
    <div className="investor-document-grid" data-count={documents.length}>
      {documents.map((document) => <a key={document.id}
        href={`${API_BASE_URL}/v1/events/${event.id}/documents/${document.id}`}
        target="_blank" rel="noopener noreferrer" title={document.fileName}>
        <DocumentIcon />
        <span className="investor-document-copy">
          <DocumentName fileName={document.fileName} />
          <small>PDF - {document.pageCount} page{document.pageCount === 1 ? '' : 's'}</small>
        </span>
        <ArrowIcon />
      </a>)}
    </div>
  </section>;
}
