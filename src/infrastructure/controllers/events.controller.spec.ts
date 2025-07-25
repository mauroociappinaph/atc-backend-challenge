import { Test, TestingModule } from '@nestjs/testing';
import { EventBus } from '@nestjs/cqrs';

import { EventsController } from './events.controller';

describe('EventsController', () => {
  let controller: EventsController;
  let eventBus: jest.Mocked<EventBus>;

  beforeEach(async () => {
    const mockEventBus = {
      publish: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [EventsController],
      providers: [
        {
          provide: EventBus,
          useValue: mockEventBus,
        },
      ],
    }).compile();

    controller = module.get<EventsController>(EventsController);
    eventBus = module.get(EventBus);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('receiveEvent', () => {
    it('should publish booking_created events to the event bus', async () => {
      const mockEvent = {
        type: 'booking_created' as const,
        clubId: 1,
        courtId: 2,
        slot: {
          price: 100,
          duration: 60,
          datetime: '2025-07-26T10:00:00Z',
          start: '10:00',
          end: '11:00',
          _priority: 1,
        },
      };

      await controller.receiveEvent(mockEvent);

      expect(eventBus.publish).toHaveBeenCalledTimes(1);
    });

    it('should publish club_updated events to the event bus', async () => {
      const mockEvent = {
        type: 'club_updated' as const,
        clubId: 1,
        fields: ['openhours' as const],
      };

      await controller.receiveEvent(mockEvent);

      expect(eventBus.publish).toHaveBeenCalledTimes(1);
    });
  });
});
