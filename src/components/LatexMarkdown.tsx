import React from 'react';
import { StyleSheet, View } from 'react-native';
import { MarkdownIt } from '@ronradtke/react-native-markdown-display';
import { MathJaxSvg } from 'react-native-mathjax-html-to-svg';

function findClosingDelimiter(
  source: string,
  start: number,
  close: string,
  isValidClose?: (index: number) => boolean
): number {
  let cursor = start;
  while (cursor < source.length) {
    const index = source.indexOf(close, cursor);
    if (index < 0) return -1;
    let slashCount = 0;
    for (let i = index - 1; i >= 0 && source[i] === '\\'; i -= 1) slashCount += 1;
    if (slashCount % 2 === 0 && (!isValidClose || isValidClose(index))) return index;
    cursor = index + close.length;
  }
  return -1;
}

function latexPlugin(md: any) {
  md.inline.ruler.after('escape', 'latex_inline', (state: any, silent: boolean) => {
    const source = state.src;
    const start = state.pos;
    let open = '';
    let close = '';

    if (source.startsWith('\\(', start)) {
      open = '\\(';
      close = '\\)';
    } else if (source.startsWith('$$', start)) {
      open = '$$';
      close = '$$';
    } else if (source[start] === '$' && source[start + 1] !== '$') {
      if (/\s/.test(source[start + 1] || '')) return false;
      open = '$';
      close = '$';
    } else {
      return false;
    }

    const end = findClosingDelimiter(
      source,
      start + open.length,
      close,
      open === '$'
        ? (index) => {
            // Pandoc inline-math rule: the closing delimiter must have a
            // non-space character on its left and must not be followed by a
            // digit. This keeps currency such as "$20 and $30" as plain text.
            return !/\s/.test(source[index - 1] || '') && !/\d/.test(source[index + 1] || '');
          }
        : undefined
    );
    if (end < 0 || end === start + open.length) return false;

    if (!silent) {
      const token = state.push('latex_inline', 'math', 0);
      token.content = source.slice(start + open.length, end);
      token.markup = open;
    }
    state.pos = end + close.length;
    return true;
  });

  md.block.ruler.before('fence', 'latex_block', (state: any, startLine: number, endLine: number, silent: boolean) => {
    const start = state.bMarks[startLine] + state.tShift[startLine];
    const lineEnd = state.eMarks[startLine];
    const firstLine = state.src.slice(start, lineEnd);
    const trimmed = firstLine.trim();
    const open = trimmed.startsWith('$$') ? '$$' : trimmed.startsWith('\\[') ? '\\[' : '';
    if (!open) return false;
    const close = open === '$$' ? '$$' : '\\]';

    let contentStart = start + firstLine.indexOf(open) + open.length;
    let closeIndex = findClosingDelimiter(state.src, contentStart, close);
    const firstLineClose = closeIndex >= 0 && closeIndex <= lineEnd;

    if (!firstLineClose) {
      closeIndex = -1;
      for (let line = startLine + 1; line < endLine; line += 1) {
        const candidate = findClosingDelimiter(
          state.src,
          state.bMarks[line] + state.tShift[line],
          close
        );
        if (candidate >= 0 && candidate <= state.eMarks[line]) {
          closeIndex = candidate;
          break;
        }
      }
    }
    if (closeIndex < 0) return false;
    const closingLineEnd = state.src.indexOf('\n', closeIndex);
    const remainderEnd = closingLineEnd < 0 ? state.src.length : closingLineEnd;
    if (state.src.slice(closeIndex + close.length, remainderEnd).trim()) return false;
    if (silent) return true;

    const token = state.push('latex_block', 'math', 0);
    token.block = true;
    token.content = state.src.slice(contentStart, closeIndex).trim();
    token.map = [startLine, startLine + 1];
    token.markup = open;

    let nextLine = startLine + 1;
    while (nextLine < endLine && state.bMarks[nextLine] <= closeIndex) nextLine += 1;
    state.line = nextLine;
    return true;
  });
}

export const latexMarkdownIt = MarkdownIt({ typographer: true }).use(latexPlugin);

export const LatexMarkdownNode = React.memo(function LatexMarkdownNode({
  content,
  color,
  fontSize,
  block,
}: {
  content: string;
  color: string;
  fontSize: number;
  block?: boolean;
}) {
  const expression = block ? `$$${content}$$` : `\\(${content}\\)`;
  return (
    <View style={block ? styles.block : styles.inline}>
      <MathJaxSvg color={color} fontSize={fontSize} fontCache>
        {expression}
      </MathJaxSvg>
    </View>
  );
});

const styles = StyleSheet.create({
  inline: {
    alignSelf: 'baseline',
    flexShrink: 1,
  },
  block: {
    alignSelf: 'stretch',
    marginVertical: 6,
    overflow: 'hidden',
  },
});
