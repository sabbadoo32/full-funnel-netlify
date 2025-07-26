const { MongoClient } = require('mongodb');
const { OpenAI } = require('openai');

// Initialize OpenAI with rate limiting
if (!process.env.OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY is not set in environment variables');
  process.exit(1);
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Rate limiting setup
let lastRequestTime = 0;
const MIN_REQUEST_GAP = 1000; // Minimum 1 second between requests

// Model configuration - matching test script that worked 36 hours ago
const MODEL = 'gpt-4';

// Helper for rate-limited OpenAI calls
async function callOpenAI(messages) {
  // Rate limiting
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  if (timeSinceLastRequest < MIN_REQUEST_GAP) {
    await new Promise(resolve => setTimeout(resolve, MIN_REQUEST_GAP - timeSinceLastRequest));
  }
  
  const completion = await openai.chat.completions.create({
    model: MODEL,
    messages: messages
  });
  lastRequestTime = Date.now();
  return completion;
}

// Initialize MongoDB connection with validation
const mongoUri = process.env.MONGODB_URI;
if (!mongoUri?.trim()) {
  throw new Error('MONGODB_URI is not defined or empty');
}

// MongoDB client setup with serverless-friendly settings
let cachedClient = null;
let cachedDb = null;

async function connectToDatabase() {
  if (cachedClient && cachedDb) {
    return { client: cachedClient, db: cachedDb };
  }

  try {
    console.log('Attempting MongoDB connection...');
    // Extract host from URI for simplified connection
    const uri = mongoUri.split('@')[1].split('/')[0];
    const simplifiedUri = `mongodb+srv://sebastianjames:d%402119ChartwellDrive@${uri}?retryWrites=true&w=majority`;
    
    const client = await MongoClient.connect(simplifiedUri, {
      serverSelectionTimeoutMS: 5000, // Fail fast if connection can't be established
      useNewUrlParser: true,
      useUnifiedTopology: true,
      // Add serverless-friendly settings
      maxPoolSize: 1, // Limit pool size for serverless
      minPoolSize: 0, // Allow pool to shrink to 0
      maxIdleTimeMS: 5000, // Close idle connections after 5 seconds
    });

    // Test the connection
    const db = client.db('full_funnel'); // Explicitly select database
    await db.command({ ping: 1 });
    console.log('MongoDB connection successful');
    
    cachedClient = client;
    cachedDb = db;
    
    return { client, db };
  } catch (error) {
    console.error('MongoDB connection error:', error);
    // Log more details about the error
    console.error('Error name:', error.name);
    console.error('Error code:', error.code);
    console.error('Error message:', error.message);
    throw error;
  }
}

exports.handler = async (event, context) => {
  // Important: Reuse the MongoDB connection
  context.callbackWaitsForEmptyEventLoop = false;

  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      }
    };
  }

  try {
    if (event.httpMethod !== 'POST') {
      return { 
        statusCode: 405, 
        body: JSON.stringify({ error: 'Method Not Allowed' })
      };
    }

    const { message } = JSON.parse(event.body);
    const db = await connectToDatabase();
    const collection = db.collection('full_funnel');

    // Process query with GPT-4
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: "You are a marketing analytics expert. Convert this query into a MongoDB query and analysis plan."
        },
        {
          role: "user",
          content: message
        }
      ]
    });

    const analysis = JSON.parse(completion.choices[0].message.content);
    
    // Execute MongoDB query
    const data = await collection.find(analysis.query).toArray();

    // Generate insights
    const insightsCompletion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: "Analyze this marketing data and provide actionable insights for managers."
        },
        {
          role: "user",
          content: JSON.stringify({
            query: message,
            data: data
          })
        }
      ]
    });

    const insights = JSON.parse(insightsCompletion.choices[0].message.content);

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        data,
        explanation: analysis.explanation,
        insights,
        managerSummary: {
          keyMetrics: insights.keyMetrics || [],
          recommendations: insights.recommendations || [],
          trends: insights.trends || []
        }
      })
    };

  } catch (error) {
    console.error('Function error:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        error: 'Internal Server Error',
        details: error.message
      })
    };
  }
};
