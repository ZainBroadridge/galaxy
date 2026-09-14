import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const ts = createRequire(import.meta.url)('typescript');
const read = (file) => readFile(new URL(`../../../${file}`, import.meta.url), 'utf8');
const jsx = (type, props) => ({ type, props: props ?? {} });
const nothing = () => null;

async function loadJsx(file, imports = {}) {
  const source = await read(file);
  const compiled = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } });
  const dependencies = { 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'fragment' }, ...imports };
  const exports = {};
  vm.runInNewContext(compiled.outputText, { exports, require: (name) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
    return dependencies[name];
  } });
  return exports;
}

function nodes(tree) {
  if (tree == null || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (typeof tree.type === 'function') return nodes(tree.type(tree.props));
  return [tree, ...nodes(tree.props.children)];
}

test('the organiser header renders the bundled logo as an image and retains its home link and Broadridge credit', async () => {
  const brand = await loadJsx('apps/web/src/components/BrandLockup.jsx');
  const assetUrl = '/assets/proxyvote-blue.test.png';
  const layout = await loadJsx('apps/web/src/issuer/IssuerLayout.jsx', {
    'react-router-dom': { Link: 'a', NavLink: 'a', Outlet: nothing, useLocation: () => ({ pathname: '/organiser' }) },
    '../appkit.js': { reownConfigured: true },
    '../components/BrandLockup.jsx': brand,
    '../assets/proxyvote-blue.png': { default: assetUrl },
    '../components/UI.jsx': { Notice: nothing },
    '../notifications.jsx': { useNotifications: () => ({ unreadCount: 0 }) },
    '../wallet.jsx': { useWallet: () => ({ connected: false, openWallet: nothing }) },
    './IssuerSession.jsx': { useIssuerSession: () => ({ logout: nothing }) },
  });
  const tree = nodes(layout.default());
  const link = tree.find((node) => node.type === 'a' && node.props['aria-label'] === 'ProxyVote home');
  assert.ok(link);
  assert.equal(link.props.to, '/issuer/home');
  const images = nodes(link).filter((node) => node.type === 'img');
  assert.equal(images.length, 2);
  const logo = images.find((node) => node.props.alt === 'ProxyVote');
  assert.ok(logo);
  assert.equal(logo.props.src, assetUrl, 'Use the imported build asset, not a mask or a public-path placeholder.');
  assert.equal(logo.props.className, 'issuer-proxyvote-logo');
  assert.equal(logo.props.width, '158');
  assert.equal(logo.props.height, '58');
  assert.equal(images.find((node) => node.props.alt === 'Broadridge').props.src, '/investor/broadridge.png');
});

test('the organiser image keeps its aspect ratio and transparent background at desktop and mobile sizes', async () => {
  const css = await read('apps/web/src/issuer/issuer.css');
  const declarations = [...css.matchAll(/\.issuer-shell \.pv-brand-lockup \.issuer-proxyvote-logo\s*\{([^}]+)\}/gu)]
    .map((match) => match[1]);
  assert.equal(declarations.length, 2);
  assert.match(declarations[0], /width:\s*118px/u);
  assert.match(declarations[0], /height:\s*auto/u);
  assert.match(declarations[0], /aspect-ratio:\s*158\s*\/\s*58/u);
  assert.match(declarations[0], /object-fit:\s*contain/u);
  assert.match(declarations[0], /background:\s*transparent/u);
  assert.match(declarations[1], /width:\s*80px/u);
  for (const declaration of declarations) assert.doesNotMatch(declaration, /mask|filter|gradient/u);
});
