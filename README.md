# Full Funnel Analytics - Serverless Deployment

This repository contains the serverless deployment configuration for the Full Funnel Analytics system. It's designed to run on Netlify Functions and provides the backend API for the CustomGPT interface.

## Overview

This is the deployment repository, optimized for Netlify Functions. It contains only the serverless implementation of our analytics API. The main development repository is maintained separately.

### Key Features

- Serverless API endpoint for analytics queries
- MongoDB integration for data storage
- GPT-4 powered natural language query processing
- Manager-friendly analytics insights and reporting

## Architecture

- **Backend**: Netlify Functions (Serverless)
- **Database**: MongoDB
- **AI Processing**: OpenAI GPT-4
- **Frontend**: CustomGPT Interface

## Environment Variables

Required environment variables in Netlify:

```
MONGODB_URI=your_mongodb_connection_string
OPENAI_API_KEY=your_openai_project_key
```

## API Endpoint

Once deployed, the API will be available at:
```
https://[your-netlify-site].netlify.app/api/chat-query
```

## Deployment

1. Connect this repository to Netlify
2. Set required environment variables
3. Deploy
4. Update CustomGPT to use the new API endpoint

## Development vs Deployment

This repository is specifically for deployment. For development:
- Use the main development repository for local development and testing
- This repo contains only the optimized serverless implementation
- Changes should be tested in the development environment before updating this deployment
