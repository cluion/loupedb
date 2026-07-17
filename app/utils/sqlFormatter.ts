let formatter: Promise<typeof import('sql-formatter')> | null = null

export async function formatPostgresSql(source: string): Promise<string> {
  if (!source.trim()) return source

  formatter ??= import('sql-formatter')
  const { format } = await formatter
  return format(source, {
    language: 'postgresql',
    keywordCase: 'upper',
    tabWidth: 2,
    useTabs: false,
    linesBetweenQueries: 1,
  })
}
