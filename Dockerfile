# Use Node.js 18 Alpine for smaller image size
FROM node:18-alpine

# Set environment variables
ENV NODE_ENV=production

# Create app directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install app dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy app source
COPY . .

# Create a non-root user to run our application
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001

# Change ownership of the app directory to nodejs user
RUN chown -R nodejs:nodejs /usr/src/app
USER nodejs

# Expose port
EXPOSE 3000

# Start the application
CMD ["npm", "start"]