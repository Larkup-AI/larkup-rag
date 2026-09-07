/** True when a response is an anti-bot challenge instead of website content. */
export function isBotProtectionPage(content: string): boolean {
  if (!content) return false;
  const lower = content.toLowerCase();
  return (
    lower.includes('verification successful. waiting for') ||
    lower.includes('please verify you are a human') ||
    lower.includes('checking if the site connection is secure') ||
    lower.includes('just a moment...') ||
    lower.includes('enable javascript and cookies to continue') ||
    lower.includes("making sure you're not a bot") ||
    lower.includes('protected by anubis') ||
    lower.includes('anubis could not load its javascript') ||
    lower.includes('this website is running anubis version')
  );
}
