import { query } from '@/lib/graphql';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { query: source, variables } = await request.json();
    const data = await query({ source, variableValues: variables });
    return NextResponse.json({ data });
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error }, { status: 500 });
  }
}
