# Project Requirements: Task Management API

Build a full-featured task management REST API with the following requirements:

## Core Features

### Tasks
- Create, read, update, delete tasks
- Each task has: title, description, status (todo/in-progress/done), priority (low/medium/high), due date, created/updated timestamps
- Filter tasks by status, priority, and due date range
- Sort tasks by any field
- Paginated listing

### Projects
- Create, read, update, delete projects
- Each project has: name, description, created/updated timestamps
- Tasks belong to a project
- List all tasks for a project

### Tags
- Create and assign tags to tasks
- Filter tasks by tags
- Many-to-many relationship

## API Requirements
- RESTful JSON API
- Input validation with meaningful error messages
- Proper HTTP status codes
- CORS support
- Rate limiting (100 requests/minute per IP)

## Data Storage
- Use a relational database
- Include migrations
- Seed data for development

## Testing
- Unit tests for business logic
- Integration tests for API endpoints
- Minimum 80% code coverage target

## Docker
- Dockerfile for the application
- docker-compose.yml with application + database
- Health check endpoint

## Documentation
- API documentation (OpenAPI/Swagger or equivalent)
- README with setup instructions
- Environment variable documentation
