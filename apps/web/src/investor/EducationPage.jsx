import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { InvestorFrame } from './InvestorFrame.jsx';
import { EDUCATION_INTRO, EDUCATION_SECTIONS, SHAREHOLDER_EDUCATION_URL } from './education-content.js';

function EducationLink({ link }) {
  return link ? <p><a href={link.href} target="_blank" rel="noopener noreferrer">{link.label}</a></p> : null;
}
export default function EducationPage() {
  const { hash } = useLocation();
  useEffect(() => {
    if (!hash) return;
    const target = document.getElementById(hash.slice(1));
    if (target?.tagName === 'DETAILS') target.open = true;
    target?.scrollIntoView({ block: 'start' });
  }, [hash]);
  return <InvestorFrame><article className="investor-education investor-page-width">
    <h1>Investor Education</h1><p className="investor-education-intro">{EDUCATION_INTRO}</p>
    <aside className="investor-info-note">This is a Polygon Amoy demonstration. The background material below comes from the supplied product prototype;
      an issuer name, logo or platform tag shown in a demo does not establish a live partnership or legal voting right. Review the issuer's actual documents.</aside>
    {EDUCATION_SECTIONS.map((section) => <section key={section.id} id={section.id}>
      {section.title && <h2>{section.title}</h2>}
      {section.kind === 'prose' ? <>{section.body.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}<EducationLink link={section.link} /></>
        : section.topics.map((topic) => <details key={topic.id} id={topic.id}><summary>{topic.question}</summary>
          {topic.answer.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}<EducationLink link={topic.link} /></details>)}
    </section>)}
    <p><a href={SHAREHOLDER_EDUCATION_URL} target="_blank" rel="noopener noreferrer">Visit Broadridge Shareholder Education</a></p>
  </article></InvestorFrame>;
}
