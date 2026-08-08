/**
 * Le bloc commence à la ligne « > <titre> » en colonne 0 et se poursuit tant
 * que les lignes suivantes sont À LA FOIS indentées (tabulation ou espaces en
 * tête) ET commencent par « > » une fois cette indentation retirée — c'est
 * exactement la forme que le plugin génère. La première ligne qui rompt
 * cette règle (ou une ligne vide) marque la fin du bloc.
 *
 * Une ligne non indentée commençant par « > » (une citation utilisateur en
 * colonne 0, par exemple) ne remplit qu'une des deux conditions et n'est donc
 * pas absorbée. Une ligne indentée commençant elle aussi par « > » reste un
 * cas ambigu, inhérent au choix de délimiter le bloc sans marqueur technique
 * dédié : ce n'est pas résolu ici.
 */
function findBlockRange(lines, blockTitle) {
  const startIndex = lines.findIndex((line) => line.trimStart().startsWith(`> ${blockTitle}`))
  if (startIndex === -1) return null
  let endIndex = startIndex
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]
    const indentMatch = line.match(/^[\t ]+/)
    const isContinuation = Boolean(indentMatch) && line.slice(indentMatch[0].length).startsWith('>')
    if (!isContinuation || line.trim() === '') break
    endIndex = index
  }
  return { start: startIndex, end: endIndex }
}

/**
 * Toutes les occurrences du bloc dans la note, dans l'ordre. Chaque
 * recherche repart juste après la fin de la précédente : les plages ne se
 * chevauchent jamais.
 */
function findAllBlockRanges(lines, blockTitle) {
  const ranges = []
  let offset = 0
  while (offset <= lines.length) {
    const range = findBlockRange(lines.slice(offset), blockTitle)
    if (!range) break
    ranges.push({ start: range.start + offset, end: range.end + offset })
    offset += range.end + 1
  }
  return ranges
}

/** Position d'insertion : après le frontmatter s'il existe, sinon en tête. */
function insertionPoint(lines) {
  if (lines[0] !== '---') return 0
  const closing = lines.indexOf('---', 1)
  return closing === -1 ? 0 : closing + 1
}

/**
 * Remplace le premier bloc trouvé par newBlock et supprime tout doublon
 * éventuel repéré plus loin dans la note (bloc résiduel d'une exécution
 * précédente, copier-coller accidentel…), sans toucher au contenu qui les
 * entoure. Si aucun bloc n'existe, insère newBlock après le frontmatter.
 */
function replaceBlock(content, blockTitle, newBlock) {
  const text = String(content || '')
  if (!text.trim()) return newBlock
  const lines = text.split('\n')
  const ranges = findAllBlockRanges(lines, blockTitle)
  if (ranges.length > 0) {
    for (let i = ranges.length - 1; i >= 1; i -= 1) {
      const { start, end } = ranges[i]
      lines.splice(start, end - start + 1)
    }
    const first = ranges[0]
    lines.splice(first.start, first.end - first.start + 1, ...newBlock.split('\n'))
    return lines.join('\n')
  }
  const at = insertionPoint(lines)
  lines.splice(at, 0, ...newBlock.split('\n'))
  return lines.join('\n')
}

module.exports = { findBlockRange, findAllBlockRanges, insertionPoint, replaceBlock }
