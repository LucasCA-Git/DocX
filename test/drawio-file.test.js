'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isDrawioPath, isDrawioSvg, diagramXmlFromFile, svgFromExportData, fallbackSvg, withDiagramXml,
} = require('../src/shared/drawio-file');

const MX = '<mxfile host="embed.diagrams.net"><diagram id="a" name="Página-1">7Vbb&amp;x</diagram></mxfile>';
const escaped = MX.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

test('recognizes diagram files', () => {
  assert.ok(isDrawioPath('a/Fluxo.drawio'));
  assert.ok(isDrawioPath('Fluxo.drawio.svg'));
  assert.ok(isDrawioPath('FLUXO.DRAWIO.SVG'));
  assert.ok(!isDrawioPath('Fluxo.svg'));
  assert.ok(!isDrawioPath('Fluxo.drawio.png'));
  assert.ok(isDrawioSvg('Fluxo.drawio.svg'));
  assert.ok(!isDrawioSvg('Fluxo.drawio'));
});

test('diagram XML from a .drawio file is the file itself', () => {
  assert.equal(diagramXmlFromFile(MX), MX);
  assert.equal(diagramXmlFromFile('  \n'), '');
});

test('diagram XML from an editable SVG comes from its content attribute', () => {
  const file = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x.dtd">\n<svg xmlns="http://www.w3.org/2000/svg" width="10px" content="${escaped}&#xa;" height="5px"><g/></svg>`;
  assert.equal(diagramXmlFromFile(file), `${MX}\n`);
  assert.equal(diagramXmlFromFile(`<svg content='${MX.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#39;')}'></svg>`).startsWith('<mxfile'), true);
  assert.equal(diagramXmlFromFile('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'), '');
});

test('export data URL (base64 or percent-encoded) becomes SVG text, UTF-8 included', () => {
  const svg = '<svg content="x">Ação → ✓</svg>';
  const b64 = Buffer.from(svg, 'utf8').toString('base64');
  assert.equal(svgFromExportData(`data:image/svg+xml;base64,${b64}`), svg);
  assert.equal(svgFromExportData(`data:image/svg+xml,${encodeURIComponent(svg)}`), svg);
  assert.equal(svgFromExportData(svg), svg);
  assert.throws(() => svgFromExportData('data:text/html;base64,PHNjcmlwdD4='), /SVG/);
});

test('fallback SVG keeps the diagram and round-trips', () => {
  const svg = fallbackSvg(MX);
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.doesNotMatch(svg.replace(/content="[^"]*"/, ''), /mxfile/);
  assert.equal(diagramXmlFromFile(svg), MX);
});

test('withDiagramXml swaps the diagram of an exported SVG and keeps its picture', () => {
  const picture = `<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" content="${escaped}" width="20px"><rect width="5"/></svg>`;
  const next = '<mxfile><diagram id="b">novo "texto" & <tags> $& $1 $\'</diagram></mxfile>';
  const out = withDiagramXml(picture, next);
  assert.equal(diagramXmlFromFile(out), next);
  assert.match(out, /<rect width="5"\/><\/svg>$/);
  assert.match(out, /width="20px"/);
  assert.equal(diagramXmlFromFile(withDiagramXml('<svg xmlns="http://www.w3.org/2000/svg"><g/></svg>', next)), next);
  assert.equal(diagramXmlFromFile(withDiagramXml('', next)), next);
});
