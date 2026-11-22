import type { MetadataRoute } from "next";

// Everything behind the login is private, so crawlers are kept out of it
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/sets", "/flashcards", "/upgrade", "/account"] },
  };
}
