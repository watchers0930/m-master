/** An explicit upstream refusal is safe to retry; transport/response uncertainty is not. */
export class ChannelRejection extends Error {
  constructor() { super('channel_rejected'); }
}
