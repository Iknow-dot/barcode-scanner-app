# Stage 1: Build stage
FROM node:22 as builder

WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies. --legacy-peer-deps mirrors how the lockfile was
# generated: TipTap 3 declares React 19 as a peer, this project is on
# React 18, and they work together at runtime — npm just won't resolve
# without the flag.
RUN npm install --legacy-peer-deps

# Copy the rest of the application
COPY . .

# Expose port 3000
EXPOSE 3000

# Start the application using npm start
CMD ["npm", "start"]