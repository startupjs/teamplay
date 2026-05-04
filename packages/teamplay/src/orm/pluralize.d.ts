declare module 'pluralize' {
  interface Pluralize {
    (word: string, count?: number, inclusive?: boolean): string
    singular: (word: string) => string
    plural: (word: string) => string
    isSingular: (word: string) => boolean
    isPlural: (word: string) => boolean
  }

  const pluralize: Pluralize
  export default pluralize
}
