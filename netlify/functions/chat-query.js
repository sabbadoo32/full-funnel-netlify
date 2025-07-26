const { MongoClient } = require('mongodb');
const OpenAI = require('openai');

// Initialize OpenAI and MongoDB with environment variables
let openai;
let cachedDb = null;
let client = null;

// Reuse connection
async function connectToDatabase() {
  if (cachedDb && client) {
    console.log('Using cached database connection');
    return cachedDb;
  }

  try {
    const mongoUrl = process.env.MONGODB_URI;
    if (!mongoUrl) {
      throw new Error('MONGODB_URI environment variable is not set');
    }

    console.log('Creating new MongoDB connection...');
    client = new MongoClient(mongoUrl, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 30000,
      serverApi: {
        version: '1',
        strict: true,
        deprecationErrors: true
      }
    });

    await client.connect();
    
    // Get database name from connection string
    const dbName = mongoUrl.split('/').pop().split('?')[0];
    cachedDb = client.db(dbName);
    
    console.log('MongoDB connected successfully');
    return cachedDb;
  } catch (error) {
    console.error('MongoDB connection error:', error);
    throw error;
  }
}

exports.handler = async (event, context) => {
  try {
    // Important: Reuse the MongoDB connection
    context.callbackWaitsForEmptyEventLoop = false;

    // Initialize OpenAI with environment variables
    if (!openai) {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        console.error('OPENAI_API_KEY not found in process.env:', process.env);
        return {
          statusCode: 500,
          body: JSON.stringify({ error: 'OPENAI_API_KEY environment variable is not set' })
        };
      }
      openai = new OpenAI({ apiKey });
    }

    // Connect to MongoDB
    let db;
    try {
      db = await connectToDatabase();
      if (!db) {
        throw new Error('Database connection returned null');
      }
    } catch (dbError) {
      console.error('MongoDB connection error:', dbError);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to connect to MongoDB', details: dbError.message })
      };
    }

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
      await connectToDatabase();

      // First, check if clarification is needed
      const clarificationCompletion = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: `You are a friendly, helpful marketing analytics expert. Check if the query needs clarification.`
          },
          {
            role: "user",
            content: message
          }
        ]
      });

      const clarificationResponse = clarificationCompletion.choices[0].message.content;
      let clarification;
      try {
        clarification = JSON.parse(clarificationResponse);
        if (clarification.needsClarification) {
          return {
            statusCode: 200,
            headers: {
              'Access-Control-Allow-Origin': '*',
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              needsClarification: true,
              questions: clarification.questions,
              suggestions: clarification.suggestions || []
            })
          };
        }
      } catch (e) {
        console.error('Failed to parse clarification:', e);
      }

      // Generate MongoDB query
      const analysisCompletion = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: "Convert natural language to MongoDB query and analysis"
          },
          {
            role: "user",
            content: message
          }
        ]
      });

      const analysis = JSON.parse(analysisCompletion.choices[0].message.content);
      
      // Execute query using native MongoDB
      const collection = db.collection('events');
      const data = await collection.find(analysis.query).toArray();

      // Generate insights
      const insightsCompletion = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: "Analyze this data and provide actionable insights"
          },
          {
            role: "user",
            content: JSON.stringify({ query: message, data })
          }
        ]
      });

      return {
        statusCode: 200,
        body: JSON.stringify({ insights: insightsCompletion.choices[0].message.content })
      };
    } catch (error) {
      console.error('Error:', error);
      return {
        statusCode: 500,
        body: JSON.stringify({ 
          error: 'An error occurred while processing your request',
          details: error.message || error.toString()
        })
      };
    }
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
