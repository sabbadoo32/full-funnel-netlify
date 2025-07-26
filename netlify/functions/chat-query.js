const { MongoClient } = require('mongodb');
const OpenAI = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Try both environment variable names and validate URI
const uri = process.env.MONGODB_URI || process.env.MONGO_URI || '';
console.log('Environment variables available:', Object.keys(process.env));
console.log('MONGODB_URI present:', !!process.env.MONGODB_URI);
console.log('MONGO_URI present:', !!process.env.MONGO_URI);

if (!uri) {
  throw new Error('No MongoDB URI found in environment variables');
}

if (!uri.startsWith('mongodb://') && !uri.startsWith('mongodb+srv://')) {
  console.error('Invalid MongoDB URI format');
  console.log('URI length:', uri.length);
  console.log('URI first 10 chars:', uri.substring(0, 10));
  throw new Error('Invalid MongoDB URI format - must start with mongodb:// or mongodb+srv://');
}

const mongoClient = new MongoClient(uri);

// Reuse connection
let cachedDb = null;

async function connectToDatabase() {
  if (cachedDb) {
    return cachedDb;
  }

  await mongoClient.connect();
  const db = mongoClient.db('full_funnel');
  cachedDb = db;
  return db;
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
