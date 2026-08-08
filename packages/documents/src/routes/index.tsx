import { Button, Container, Stack, Text, Title } from '@mantine/core';
import { createFileRoute, Link } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  component: HomePage,
});

function HomePage() {
  return (
    <Container size="sm" py="xl">
      <Stack gap="md">
        <Title order={1}>Document conversion &amp; editing, entirely in your browser</Title>
        <Text c="dimmed">
          Convert between docx, pptx, xlsx, odt, odp, ods, odg, pdf, and markdown -- nothing is uploaded to a
          server, every conversion runs locally in a Web Worker.
        </Text>
        <Button component={Link} to="/convert" size="md" w="fit-content">
          Start converting
        </Button>
      </Stack>
    </Container>
  );
}
