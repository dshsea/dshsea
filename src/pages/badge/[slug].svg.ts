import type { APIRoute } from 'astro';
import { getProjects, type Project } from '../../lib/projects';
import { fmtDepth } from '../../lib/species';

export function getStaticPaths() {
  return getProjects().map((project) => ({ params: { slug: project.slug }, props: { project } }));
}

export const GET: APIRoute = ({ props }) => {
  const p = props.project as Project;
  const H = 28;
  const right = `${p.species} · ${fmtDepth(p.depth)}`;
  const leftW = 82;
  const W = Math.round(leftW + right.length * 6.6 + 22);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="dshsea: ${right}">
<title>${p.name.replace(/[<>&"]/g, '')} lives ${fmtDepth(p.depth)} down on dshsea.com</title>
<defs>
<linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#0d3f7c"/><stop offset="1" stop-color="#04102a"/></linearGradient>
<clipPath id="r"><rect width="${W}" height="${H}" rx="14"/></clipPath>
</defs>
<g clip-path="url(#r)">
<rect width="${W}" height="${H}" fill="url(#g)"/>
<rect width="${leftW}" height="${H}" fill="#6ef3d6"/>
</g>
<circle cx="17" cy="14" r="6" fill="none" stroke="#04102a" stroke-width="1.6"/>
<path d="M11.6 15.2c1.8-1.4 3.6 1.4 5.4 0s3.6 1.4 5.4 0" fill="none" stroke="#04102a" stroke-width="1.6" stroke-linecap="round"/>
<g font-family="Inter,Helvetica Neue,Arial,sans-serif" font-size="12">
<text x="29" y="18.2" font-weight="700" fill="#04102a">dshsea</text>
<text x="${leftW + 11}" y="18.2" fill="#dbe8ff">${right}</text>
</g>
</svg>`;
  return new Response(svg, { headers: { 'Content-Type': 'image/svg+xml; charset=utf-8' } });
};
