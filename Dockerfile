FROM mcr.microsoft.com/playwright:v1.58.2-jammy

WORKDIR /app

# Force Playwright to use browsers that already exist in the Playwright image
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY . .

EXPOSE 3000
CMD ["node", "bootstrap.js"]
