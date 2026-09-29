const labels = {
  班級: 'className',
  座號: 'seatNumber',
  姓名: 'studentName',
}

export function parseOcrFields(text) {
  const fields = {
    className: '—',
    seatNumber: '—',
    studentName: '—',
  }

  for (const line of text.split(/\r?\n/)) {
    const matches = [...line.matchAll(/(班級|座號|姓名)\s*[:：]\s*/g)]

    matches.forEach((match, index) => {
      const field = labels[match[1]]
      if (fields[field] !== '—') return

      const start = match.index + match[0].length
      const end = matches[index + 1]?.index ?? line.length
      const value = line
        .slice(start, end)
        .replace(/^[\s,，;；、。]+|[\s,，;；、。]+$/g, '')
        .trim()

      if (value) fields[field] = value
    })
  }

  return fields
}
