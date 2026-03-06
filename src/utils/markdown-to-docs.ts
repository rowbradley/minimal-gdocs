import { docs_v1 } from 'googleapis';

type Request = docs_v1.Schema$Request;

interface InlineStyle {
  start: number;  // relative to clean text
  end: number;
  type: 'bold' | 'italic' | 'link';
  url?: string;
}

interface TableCell {
  cleanText: string;
  styles: InlineStyle[];
}

interface Block {
  type: 'heading' | 'paragraph' | 'bullet' | 'numbered' | 'code' | 'hr' | 'table' | 'blockquote';
  level?: number;
  cleanText: string;  // text with markdown syntax stripped
  styles: InlineStyle[];
  rows?: number;
  cols?: number;
  cells?: TableCell[][];  // cells[rowIndex][colIndex]
}

/**
 * Convert markdown to Google Docs API requests
 * Two-pass approach: collect all content first, then generate requests
 */
export function markdownToDocsRequests(markdown: string): Request[] {
  // Pass 1: Parse markdown into blocks
  const blocks = parseMarkdown(markdown);

  // Pass 2: Generate requests (inserts first, then formatting)
  return generateRequests(blocks);
}

function parseMarkdown(markdown: string): Block[] {
  const blocks: Block[] = [];
  const lines = markdown.split('\n');
  let inCodeBlock = false;
  let codeBlockContent = '';
  let inTable = false;
  let tableRows: string[][] = [];

  function flushTable() {
    if (tableRows.length > 0) {
      const maxCols = Math.max(...tableRows.map(r => r.length));
      const cells: TableCell[][] = tableRows.map(row => {
        const paddedRow = [...row];
        while (paddedRow.length < maxCols) paddedRow.push('');
        return paddedRow.map(cellText => parseInlineFormatting(cellText));
      });

      blocks.push({
        type: 'table',
        cleanText: '',
        styles: [],
        rows: tableRows.length,
        cols: maxCols,
        cells
      });
    }
    inTable = false;
    tableRows = [];
  }

  for (const line of lines) {
    // Handle code blocks
    if (line.startsWith('```')) {
      if (inTable) flushTable();
      if (inCodeBlock) {
        if (codeBlockContent) {
          blocks.push({
            type: 'code',
            cleanText: codeBlockContent,
            styles: []
          });
        }
        inCodeBlock = false;
        codeBlockContent = '';
      } else {
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockContent += (codeBlockContent ? '\n' : '') + line;
      continue;
    }

    // Handle table rows
    const isTableRow = /^\s*\|(.+)\|\s*$/.test(line);
    const isSeparatorRow = /^\s*\|[\s\-:|]+\|\s*$/.test(line);

    if (isTableRow) {
      if (isSeparatorRow) {
        inTable = true;
        continue;
      }

      inTable = true;
      const cells = line.trim().split('|').slice(1, -1).map(c => c.trim());
      tableRows.push(cells);
      continue;
    }

    // Flush pending table on non-table line
    if (inTable) flushTable();

    // Skip empty lines - add empty paragraph
    if (!line.trim()) {
      blocks.push({ type: 'paragraph', cleanText: '', styles: [] });
      continue;
    }

    // Parse the line into a block
    blocks.push(parseLine(line));
  }

  // Flush any pending table at EOF
  if (inTable) flushTable();

  return blocks;
}

function parseLine(line: string): Block {
  // Headings: # Heading
  const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
  if (headingMatch) {
    const { cleanText, styles } = parseInlineFormatting(headingMatch[2]);
    return { type: 'heading', level: headingMatch[1].length, cleanText, styles };
  }

  // Horizontal rule: --- or *** or ___
  if (/^[-*_]{3,}$/.test(line.trim())) {
    return { type: 'hr', cleanText: '', styles: [] };
  }

  // Bullet lists: - item or * item
  const bulletMatch = line.match(/^(\s*)[-*]\s+(.+)$/);
  if (bulletMatch) {
    const { cleanText, styles } = parseInlineFormatting(bulletMatch[2]);
    return { type: 'bullet', level: Math.floor(bulletMatch[1].length / 2), cleanText, styles };
  }

  // Numbered lists: 1. item
  const numberedMatch = line.match(/^(\s*)\d+\.\s+(.+)$/);
  if (numberedMatch) {
    const { cleanText, styles } = parseInlineFormatting(numberedMatch[2]);
    return { type: 'numbered', level: Math.floor(numberedMatch[1].length / 2), cleanText, styles };
  }

  // Block quotes: > text
  const blockquoteMatch = line.match(/^>\s?(.*)$/);
  if (blockquoteMatch) {
    const { cleanText, styles } = parseInlineFormatting(blockquoteMatch[1]);
    return { type: 'blockquote', cleanText, styles };
  }

  // Regular paragraph
  const { cleanText, styles } = parseInlineFormatting(line);
  return { type: 'paragraph', cleanText, styles };
}

function parseInlineFormatting(text: string): { cleanText: string; styles: InlineStyle[] } {
  const styles: InlineStyle[] = [];

  // Track all formatting spans with their positions in original text
  interface Span {
    start: number;
    end: number;
    type: 'bold' | 'italic' | 'link';
    innerStart: number;  // where the content starts (after opening marker)
    innerEnd: number;    // where the content ends (before closing marker)
    url?: string;
  }
  const spans: Span[] = [];

  // 1. Find all links: [text](url)
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match;
  while ((match = linkRegex.exec(text)) !== null) {
    spans.push({
      type: 'link',
      start: match.index,
      end: match.index + match[0].length,
      innerStart: match.index + 1,  // after [
      innerEnd: match.index + 1 + match[1].length,  // before ]
      url: match[2]
    });
  }

  // 2. Find bold+italic: ***text*** (must be before bold/italic)
  const boldItalicRegex = /\*\*\*(.+?)\*\*\*/g;
  while ((match = boldItalicRegex.exec(text)) !== null) {
    // Add both bold and italic spans for the same range
    spans.push({
      type: 'bold',
      start: match.index,
      end: match.index + match[0].length,
      innerStart: match.index + 3,
      innerEnd: match.index + 3 + match[1].length
    });
    spans.push({
      type: 'italic',
      start: match.index,
      end: match.index + match[0].length,
      innerStart: match.index + 3,
      innerEnd: match.index + 3 + match[1].length
    });
  }

  // 3. Find bold: **text** (non-greedy, allows nested *)
  const boldRegex = /\*\*(.+?)\*\*/g;
  while ((match = boldRegex.exec(text)) !== null) {
    // Skip if this overlaps with a bold+italic span
    const overlaps = spans.some(s =>
      s.type === 'bold' &&
      !(match!.index >= s.end || match!.index + match![0].length <= s.start)
    );
    if (!overlaps) {
      spans.push({
        type: 'bold',
        start: match.index,
        end: match.index + match[0].length,
        innerStart: match.index + 2,
        innerEnd: match.index + 2 + match[1].length
      });
    }
  }

  // 4. Find italic: *text* (not adjacent to other *)
  const italicRegex = /(?<!\*)\*([^*]+)\*(?!\*)/g;
  while ((match = italicRegex.exec(text)) !== null) {
    spans.push({
      type: 'italic',
      start: match.index,
      end: match.index + match[0].length,
      innerStart: match.index + 1,
      innerEnd: match.index + 1 + match[1].length
    });
  }

  // 5. Build clean text by removing all markdown syntax
  // Sort spans by start position
  spans.sort((a, b) => a.start - b.start);

  // Build a map of characters to remove
  const toRemove = new Set<number>();
  for (const span of spans) {
    if (span.type === 'link') {
      // Remove [ ] ( url )
      toRemove.add(span.start); // [
      for (let i = span.innerEnd; i < span.end; i++) {
        toRemove.add(i); // ](url)
      }
    } else if (span.type === 'bold') {
      // Check if this is part of a *** sequence
      const isBoldItalic = spans.some(s =>
        s.type === 'italic' && s.start === span.start && s.end === span.end
      );
      if (isBoldItalic) {
        // Remove ***, not **
        toRemove.add(span.start);
        toRemove.add(span.start + 1);
        toRemove.add(span.start + 2);
        toRemove.add(span.end - 3);
        toRemove.add(span.end - 2);
        toRemove.add(span.end - 1);
      } else {
        toRemove.add(span.start);
        toRemove.add(span.start + 1);
        toRemove.add(span.end - 2);
        toRemove.add(span.end - 1);
      }
    } else if (span.type === 'italic') {
      // Skip if part of bold+italic (already handled)
      const isBoldItalic = spans.some(s =>
        s.type === 'bold' && s.start === span.start && s.end === span.end
      );
      if (!isBoldItalic) {
        toRemove.add(span.start);
        toRemove.add(span.end - 1);
      }
    }
  }

  // Build clean text and position mapping
  let cleanText = '';
  const positionMap: number[] = []; // positionMap[cleanIndex] = originalIndex
  for (let i = 0; i < text.length; i++) {
    if (!toRemove.has(i)) {
      positionMap.push(i);
      cleanText += text[i];
    }
  }

  // 6. Convert spans to styles with clean text positions
  for (const span of spans) {
    // Find where innerStart and innerEnd map to in clean text
    let cleanStart = -1;
    let cleanEnd = -1;

    for (let i = 0; i < positionMap.length; i++) {
      if (positionMap[i] >= span.innerStart && cleanStart === -1) {
        cleanStart = i;
      }
      if (positionMap[i] < span.innerEnd) {
        cleanEnd = i + 1;
      }
    }

    if (cleanStart !== -1 && cleanEnd !== -1 && cleanStart < cleanEnd) {
      // For bold+italic, we already added both spans, so skip duplicate italic
      const isDuplicateBoldItalic = span.type === 'italic' && spans.some(s =>
        s.type === 'bold' && s.start === span.start && s.end === span.end
      );

      if (!isDuplicateBoldItalic || span.type === 'bold') {
        styles.push({
          type: span.type,
          start: cleanStart,
          end: cleanEnd,
          url: span.url
        });
      }

      // Add italic style for bold+italic combo
      if (span.type === 'bold') {
        const hasMatchingItalic = spans.some(s =>
          s.type === 'italic' && s.start === span.start && s.end === span.end
        );
        if (hasMatchingItalic) {
          styles.push({
            type: 'italic',
            start: cleanStart,
            end: cleanEnd
          });
        }
      }
    }
  }

  return { cleanText, styles };
}

function generateRequests(blocks: Block[]): Request[] {
  const insertRequests: Request[] = [];
  const formatRequests: Request[] = [];

  let currentIndex = 1; // Google Docs starts at index 1

  for (const block of blocks) {
    // Handle tables separately (different insertion pattern)
    if (block.type === 'table' && block.cells && block.rows && block.cols) {
      const R = block.rows;
      const C = block.cols;
      const tableStartIndex = currentIndex;

      // Insert the table structure
      insertRequests.push({
        insertTable: {
          location: { index: tableStartIndex },
          rows: R,
          columns: C
        }
      });

      // Build list of cells with content
      const cellInserts: { r: number; c: number; text: string; styles: InlineStyle[] }[] = [];
      for (let r = 0; r < R; r++) {
        for (let c = 0; c < C; c++) {
          const cell = block.cells[r][c];
          if (cell.cleanText) {
            cellInserts.push({ r, c, text: cell.cleanText, styles: cell.styles });
          }
        }
      }

      // Insert cell text in reverse order (last cell first, so index shifts don't cascade)
      for (let i = cellInserts.length - 1; i >= 0; i--) {
        const entry = cellInserts[i];
        const cellIndex = tableStartIndex + 4 + entry.r * (1 + C * 2) + entry.c * 2;
        insertRequests.push({
          insertText: {
            location: { index: cellIndex },
            text: entry.text
          }
        });
      }

      // Formatting: compute final positions with cumulative shift tracking
      let cumulativeShift = 0;
      for (let r = 0; r < R; r++) {
        for (let c = 0; c < C; c++) {
          const cell = block.cells[r][c];
          const baseCellIndex = tableStartIndex + 4 + r * (1 + C * 2) + c * 2;
          const finalCellIndex = baseCellIndex + cumulativeShift;

          if (cell.cleanText) {
            // Bold header row (row 0)
            if (r === 0) {
              formatRequests.push({
                updateTextStyle: {
                  range: { startIndex: finalCellIndex, endIndex: finalCellIndex + cell.cleanText.length },
                  textStyle: { bold: true },
                  fields: 'bold'
                }
              });
            }

            // Inline styles within cells
            for (const style of cell.styles) {
              const styleStart = finalCellIndex + style.start;
              const styleEnd = finalCellIndex + style.end;

              if (style.type === 'bold') {
                formatRequests.push({
                  updateTextStyle: {
                    range: { startIndex: styleStart, endIndex: styleEnd },
                    textStyle: { bold: true },
                    fields: 'bold'
                  }
                });
              } else if (style.type === 'italic') {
                formatRequests.push({
                  updateTextStyle: {
                    range: { startIndex: styleStart, endIndex: styleEnd },
                    textStyle: { italic: true },
                    fields: 'italic'
                  }
                });
              } else if (style.type === 'link' && style.url) {
                formatRequests.push({
                  updateTextStyle: {
                    range: { startIndex: styleStart, endIndex: styleEnd },
                    textStyle: { link: { url: style.url } },
                    fields: 'link'
                  }
                });
              }
            }

            cumulativeShift += cell.cleanText.length;
          }
        }
      }

      // Advance past the table: auto-newline before + table structure, landing on auto-newline after
      currentIndex += 3 + R * (C * 2 + 1) + cumulativeShift;
      continue;
    }

    const text = block.cleanText + '\n';
    const startIndex = currentIndex;
    const endIndex = currentIndex + text.length;

    // Insert text request
    insertRequests.push({
      insertText: {
        location: { index: startIndex },
        text
      }
    });

    // Block-level formatting
    if (block.type === 'paragraph' || block.type === 'blockquote') {
      // Explicitly reset to NORMAL_TEXT to override any inherited styles
      formatRequests.push({
        updateParagraphStyle: {
          range: { startIndex, endIndex },
          paragraphStyle: { namedStyleType: 'NORMAL_TEXT' },
          fields: 'namedStyleType'
        }
      });
    }

    if (block.type === 'heading' && block.level) {
      formatRequests.push({
        updateParagraphStyle: {
          range: { startIndex, endIndex },
          paragraphStyle: { namedStyleType: getHeadingStyle(block.level) },
          fields: 'namedStyleType'
        }
      });
    } else if (block.type === 'bullet') {
      formatRequests.push({
        createParagraphBullets: {
          range: { startIndex, endIndex },
          bulletPreset: 'BULLET_DISC_CIRCLE_SQUARE'
        }
      });
    } else if (block.type === 'numbered') {
      formatRequests.push({
        createParagraphBullets: {
          range: { startIndex, endIndex },
          bulletPreset: 'NUMBERED_DECIMAL_NESTED'
        }
      });
    } else if (block.type === 'code') {
      // Font styling
      formatRequests.push({
        updateTextStyle: {
          range: { startIndex, endIndex: endIndex - 1 },
          textStyle: {
            weightedFontFamily: { fontFamily: 'Courier New' },
            fontSize: { magnitude: 10, unit: 'PT' }
          },
          fields: 'weightedFontFamily,fontSize'
        }
      });
      // Paragraph styling: shading, borders, padding
      formatRequests.push({
        updateParagraphStyle: {
          range: { startIndex, endIndex },
          paragraphStyle: {
            shading: {
              backgroundColor: { color: { rgbColor: { red: 0.95, green: 0.95, blue: 0.95 } } }
            },
            borderTop: {
              color: { color: { rgbColor: { red: 0.85, green: 0.85, blue: 0.85 } } },
              width: { magnitude: 1, unit: 'PT' },
              padding: { magnitude: 6, unit: 'PT' },
              dashStyle: 'SOLID'
            },
            borderBottom: {
              color: { color: { rgbColor: { red: 0.85, green: 0.85, blue: 0.85 } } },
              width: { magnitude: 1, unit: 'PT' },
              padding: { magnitude: 6, unit: 'PT' },
              dashStyle: 'SOLID'
            },
            borderLeft: {
              color: { color: { rgbColor: { red: 0.85, green: 0.85, blue: 0.85 } } },
              width: { magnitude: 1, unit: 'PT' },
              padding: { magnitude: 6, unit: 'PT' },
              dashStyle: 'SOLID'
            },
            borderRight: {
              color: { color: { rgbColor: { red: 0.85, green: 0.85, blue: 0.85 } } },
              width: { magnitude: 1, unit: 'PT' },
              padding: { magnitude: 6, unit: 'PT' },
              dashStyle: 'SOLID'
            },
            indentStart: { magnitude: 12, unit: 'PT' }
          },
          fields: 'shading,borderTop,borderBottom,borderLeft,borderRight,indentStart'
        }
      });
    } else if (block.type === 'hr') {
      // Google Docs doesn't have native HR - use bottom border on empty paragraph
      formatRequests.push({
        updateParagraphStyle: {
          range: { startIndex, endIndex },
          paragraphStyle: {
            borderBottom: {
              color: { color: { rgbColor: { red: 0.8, green: 0.8, blue: 0.8 } } },
              width: { magnitude: 1, unit: 'PT' },
              padding: { magnitude: 8, unit: 'PT' },
              dashStyle: 'SOLID'
            }
          },
          fields: 'borderBottom'
        }
      });
    } else if (block.type === 'blockquote') {
      // Left border + indentation
      formatRequests.push({
        updateParagraphStyle: {
          range: { startIndex, endIndex },
          paragraphStyle: {
            borderLeft: {
              color: { color: { rgbColor: { red: 0.56, green: 0.63, blue: 0.71 } } },
              width: { magnitude: 3, unit: 'PT' },
              padding: { magnitude: 6, unit: 'PT' },
              dashStyle: 'SOLID'
            },
            indentStart: { magnitude: 18, unit: 'PT' }
          },
          fields: 'borderLeft,indentStart'
        }
      });
      // Muted text color
      formatRequests.push({
        updateTextStyle: {
          range: { startIndex, endIndex: endIndex - 1 },
          textStyle: {
            foregroundColor: { color: { rgbColor: { red: 0.33, green: 0.33, blue: 0.33 } } }
          },
          fields: 'foregroundColor'
        }
      });
    }

    // Inline formatting (bold, italic, links)
    for (const style of block.styles) {
      const styleStart = startIndex + style.start;
      const styleEnd = startIndex + style.end;

      if (style.type === 'bold') {
        formatRequests.push({
          updateTextStyle: {
            range: { startIndex: styleStart, endIndex: styleEnd },
            textStyle: { bold: true },
            fields: 'bold'
          }
        });
      } else if (style.type === 'italic') {
        formatRequests.push({
          updateTextStyle: {
            range: { startIndex: styleStart, endIndex: styleEnd },
            textStyle: { italic: true },
            fields: 'italic'
          }
        });
      } else if (style.type === 'link' && style.url) {
        formatRequests.push({
          updateTextStyle: {
            range: { startIndex: styleStart, endIndex: styleEnd },
            textStyle: { link: { url: style.url } },
            fields: 'link'
          }
        });
      }
    }

    currentIndex = endIndex;
  }

  // Return inserts first, then formatting
  return [...insertRequests, ...formatRequests];
}

function getHeadingStyle(level: number): string {
  const styles: Record<number, string> = {
    1: 'HEADING_1',
    2: 'HEADING_2',
    3: 'HEADING_3',
    4: 'HEADING_4',
    5: 'HEADING_5',
    6: 'HEADING_6'
  };
  return styles[level] || 'NORMAL_TEXT';
}
