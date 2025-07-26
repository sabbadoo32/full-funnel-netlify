const mongoose = require('mongoose');
const OpenAI = require('openai');

// Initialize OpenAI and MongoDB with environment variables from context
let openai;
let uri;

// Define schema
const eventSchema = new mongoose.Schema({
  organization_name: String,
  event_type: String,
  timestamp: Date
});

// Create model
const Event = mongoose.model('Event', eventSchema);

// Reuse connection
let isConnected = false;

async function connectToDatabase() {
  if (isConnected) {
    return;
  }

  try {
    await mongoose.connect(uri);
    isConnected = true;
    console.log('MongoDB connected successfully');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    throw error;
  }
}

exports.handler = async (event, context) => {
  // Initialize OpenAI and MongoDB with environment variables from context
  if (!openai) {
    openai = new OpenAI({
      apiKey: context.OPENAI_API_KEY
    });
  }

  if (!uri) {
    uri = context.MONGODB_URI;
    if (!uri) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'MONGODB_URI environment variable is not set' })
      };
    }
  }
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
    
    // Execute query using Mongoose
    const data = await Event.find(analysis.query).lean();

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
