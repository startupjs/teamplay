export default {
  read: true,
  create: ({ session }: { session?: { userId?: string } }) => Boolean(session?.userId)
}
