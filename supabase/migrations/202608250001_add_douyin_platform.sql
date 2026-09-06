-- Add Douyin as a supported creator platform. Existing Xiaohongshu rows remain unchanged.
alter type public.platform_kind add value if not exists 'douyin';
